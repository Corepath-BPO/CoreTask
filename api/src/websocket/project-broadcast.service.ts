import { ProjectVisibility, ServerEvent } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { ProjectAccessService } from '../modules/project-access/project-access.service';

import { RealtimeGateway } from './realtime.gateway';

/**
 * Sends an event to everyone who may see the thing it is about.
 *
 * Before privacy existed every domain change went to the workspace room. A
 * private project's task titles, comments and section names cannot do that,
 * so this picks the audience: the workspace room for anything public or
 * unscoped, the member and admin user rooms for a private project. Callers
 * pass the item's `projectId` and stop thinking about it.
 *
 * Like the gateway's own emits, this never throws — losing a realtime ping is
 * not worth failing the write that caused it.
 */
@Injectable()
export class ProjectBroadcastService {
  private readonly logger = new Logger(ProjectBroadcastService.name);

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly access: ProjectAccessService,
  ) {}

  async emit(
    workspaceId: string,
    projectId: string | null | undefined,
    event: string,
    payload: unknown,
  ): Promise<void> {
    try {
      if (!projectId) {
        this.gateway.emitToWorkspace(workspaceId, event, payload);
        return;
      }

      const visibility = await this.access.visibilityOf(projectId);
      if (visibility !== ProjectVisibility.PRIVATE) {
        this.gateway.emitToWorkspace(workspaceId, event, payload);
        return;
      }

      const audience = await this.access.audienceUserIds(workspaceId, projectId);
      this.gateway.emitToUsers(audience, event, payload);
    } catch (error) {
      this.logger.error({ err: error, workspaceId, projectId, event }, 'Failed to broadcast');
    }
  }

  /** Tells people a project has appeared for them; the client refetches its lists. */
  grant(workspaceId: string, projectId: string, userIds: readonly string[]): void {
    this.gateway.emitToUsers(userIds, ServerEvent.PROJECT_ACCESS_GRANTED, {
      workspaceId,
      projectId,
    });
  }

  /**
   * Tells people a project is gone for them and takes their open tabs out of
   * its room, on every device: the room was joined while they could see it and
   * would otherwise keep delivering events they no longer may read.
   */
  async revoke(workspaceId: string, projectId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;

    this.gateway.emitToUsers(userIds, ServerEvent.PROJECT_ACCESS_REVOKED, {
      workspaceId,
      projectId,
    });

    try {
      await Promise.all(userIds.map((userId) => this.gateway.evictFromProject(projectId, userId)));
    } catch (error) {
      this.logger.error({ err: error, workspaceId, projectId }, 'Failed to evict from a project');
    }
  }
}
