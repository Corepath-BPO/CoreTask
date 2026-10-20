import { NotificationType, ProjectNotificationKind } from '@coretask/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { ItemRef } from '../../modules/followers/item-ref';

import { NotificationDispatcher } from './notification.dispatcher';

/**
 * Tells a project's members what they chose to hear about it — Asana's
 * per-project notification settings (`ProjectMember.notifyOn`). Members only:
 * someone who can open a project without being on it hears nothing from it.
 * Never the person who did it.
 */
@Injectable()
export class ProjectActivityNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  /** The members of a project who want `kind`, less anyone in `skip`. */
  async audience(
    projectId: string,
    kind: ProjectNotificationKind,
    skip: readonly (string | null | undefined)[] = [],
  ): Promise<string[]> {
    const excluded = skip.filter((id): id is string => Boolean(id));
    const rows = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        notifyOn: { has: kind },
        ...(excluded.length > 0 && { userId: { notIn: excluded } }),
        user: { isServiceAccount: false },
      },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /** A task or ticket arrived in a project: created there, or added to it. */
  async itemAdded(ref: ItemRef, projectId: string, actorId: string | null): Promise<void> {
    await this.tell(
      ref,
      projectId,
      actorId,
      ProjectNotificationKind.TASKS_ADDED,
      [],
      (who, name) => `${who} added ${ref.label} to ${name}`,
    );
  }

  /**
   * A task or ticket in a project was completed. Its followers already heard
   * from `FollowerNotifier`; pass them as `told` so nobody hears it twice.
   */
  async itemCompleted(
    ref: ItemRef,
    projectId: string,
    actorId: string | null,
    told: readonly string[],
  ): Promise<void> {
    await this.tell(
      ref,
      projectId,
      actorId,
      ProjectNotificationKind.TASKS_COMPLETED,
      told,
      (who, name) => `${who} completed ${ref.label} in ${name}`,
    );
  }

  private async tell(
    ref: ItemRef,
    projectId: string,
    actorId: string | null,
    kind: ProjectNotificationKind,
    told: readonly string[],
    phrase: (who: string, projectName: string) => string,
  ): Promise<void> {
    const recipients = await this.audience(projectId, kind, [actorId, ...told]);
    if (recipients.length === 0) return;

    const [project, actor] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      actorId
        ? this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
        : null,
    ]);
    if (!project) return;
    const title = phrase(
      actorId ? (actor?.name ?? 'Someone') : 'An automation',
      project.name,
    ).slice(0, 200);

    await Promise.all(
      recipients.map((userId) =>
        this.notifications.dispatch({
          userId,
          workspaceId: ref.workspaceId,
          type: NotificationType.PROJECT_UPDATE,
          title,
          entity: ref.entity,
          entityId: ref.entityId,
          actionUrl: ref.actionUrl,
        }),
      ),
    );
  }
}
