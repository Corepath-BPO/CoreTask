import { WebhookEventType } from '@coretask/contracts';
import type { WebhookActor, WebhookEventPayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { AutomationEvent } from '../automations/automation-event.publisher';
import { commentInclude, toCommentDto } from '../comments/comment.mapper';
import { taskInclude, toTaskDto } from '../tasks/task.mapper';
import { ticketInclude, toTicketDto } from '../tickets/ticket.mapper';

/**
 * Turns a domain event into the JSON a receiver gets.
 *
 * Built once per event, at fan-out time — seconds after the write — from the
 * same mappers the REST API uses, so a webhook's `task` is exactly the task
 * `GET /tasks/:id` would return. The result is stored on each delivery, so a
 * retry or a redelivery sends and signs identical bytes.
 */
@Injectable()
export class WebhookPayloadBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async build(event: AutomationEvent, type: WebhookEventType): Promise<WebhookEventPayload> {
    const [actor, data] = await Promise.all([
      this.actor(event.actorId ?? null),
      this.data(event, type),
    ]);

    return {
      id: event.eventId,
      type,
      createdAt: new Date().toISOString(),
      workspaceId: event.workspaceId,
      projectId: event.projectId ?? null,
      actor,
      causedByRuleId: event.causedByRuleId ?? null,
      correlationId: event.correlationId ?? null,
      data,
      // Only an update has a "before"; a creation's initial values are in `data`.
      changes: event.before ? buildChanges(event.before, event.after ?? {}) : null,
    };
  }

  /** `integration` when an API key's service account did it — receivers often want to ignore their own writes. */
  async actor(actorId: string | null): Promise<WebhookActor | null> {
    if (!actorId) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, name: true, isServiceAccount: true },
    });

    return user
      ? { id: user.id, name: user.name, kind: user.isServiceAccount ? 'integration' : 'user' }
      : null;
  }

  private async data(
    event: AutomationEvent,
    type: WebhookEventType,
  ): Promise<Record<string, unknown>> {
    switch (event.entityType) {
      case 'TASK': {
        const task = await this.task(event.workspaceId, event.entityId);

        if (type === WebhookEventType.CUSTOM_FIELD_CHANGED) {
          const before = event.before ?? {};
          const after = event.after ?? {};
          return {
            task,
            field: {
              id: after['fieldId'] ?? before['fieldId'] ?? null,
              name: after['fieldName'] ?? before['fieldName'] ?? null,
            },
            value: { before: before['value'] ?? null, after: after['value'] ?? null },
          };
        }

        return { task };
      }
      case 'COMMENT': {
        const comment = await this.prisma.comment.findFirst({
          where: { id: event.entityId, workspaceId: event.workspaceId },
          include: commentInclude,
        });
        const [task, ticket] = await Promise.all([
          comment?.taskId ? this.task(event.workspaceId, comment.taskId) : null,
          comment?.ticketId ? this.ticket(event.workspaceId, comment.ticketId) : null,
        ]);

        return { comment: comment ? toCommentDto(comment, null) : null, task, ticket };
      }
      case 'TICKET':
        return { ticket: await this.ticket(event.workspaceId, event.entityId) };
    }
  }

  /** Null when the item is gone by delivery time — receivers want to hear about deletions too. */
  async task(workspaceId: string, taskId: string) {
    const row = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      include: taskInclude,
    });
    if (!row) return null;

    const completedSubtasks = await this.prisma.task.count({
      where: { parentTaskId: taskId, archivedAt: null, completedAt: { not: null } },
    });

    return toTaskDto(row, completedSubtasks);
  }

  private async ticket(workspaceId: string, ticketId: string) {
    const row = await this.prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId },
      include: ticketInclude,
    });

    return row ? toTicketDto(row) : null;
  }
}

/** Field-by-field diff of the publisher's `before`/`after` snapshots; null when nothing differs. */
export function buildChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> | null {
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[key];
    const next = after[key];

    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes[key] = { before: previous ?? null, after: next ?? null };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}
