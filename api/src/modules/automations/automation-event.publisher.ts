import { randomUUID } from 'node:crypto';

import type { AutomationTrigger } from '@coretask/contracts';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AutomationJob, QueueName } from '../../jobs/queue-names';

/** What happened, and enough context to decide whether a rule cares. */
export interface AutomationEvent {
  workspaceId: string;
  projectId: string;
  trigger: AutomationTrigger;
  entityType: 'TASK' | 'TICKET' | 'COMMENT';
  entityId: string;
  /** Who caused it. Null when a rule did. */
  actorId?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Shared by every hop descended from one original action. */
  correlationId: string;
  /** 0 for a user action; incremented per rule hop. */
  depth: number;
  /** Set when a rule caused this, so it will not react to its own write. */
  causedByRuleId?: string | null;
}

/**
 * Publishes domain events for the automation engine.
 *
 * Deliberately a leaf: it depends on the queue and nothing else, so any module
 * that changes a task can import it without dragging the engine — and its
 * dependencies — into the request path.
 *
 * Never throws. An automation that fails to enqueue must not fail the edit that
 * triggered it; the user's change is the thing that matters.
 */
@Injectable()
export class AutomationEventPublisher {
  private readonly logger = new Logger(AutomationEventPublisher.name);

  constructor(@InjectQueue(QueueName.AUTOMATION) private readonly queue: Queue) {}

  async publish(event: Omit<AutomationEvent, 'correlationId' | 'depth'> & {
    correlationId?: string;
    depth?: number;
  }): Promise<void> {
    const payload: AutomationEvent = {
      ...event,
      // A fresh id means a user action; an inherited one means this is a
      // continuation, and that is what makes a loop traceable end to end.
      correlationId: event.correlationId ?? randomUUID(),
      depth: event.depth ?? 0,
    };

    try {
      await this.queue.add(AutomationJob.EVENT, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3_600, count: 500 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error(
        { err: error, trigger: payload.trigger, entityId: payload.entityId },
        'Could not enqueue an automation event',
      );
    }
  }
}
