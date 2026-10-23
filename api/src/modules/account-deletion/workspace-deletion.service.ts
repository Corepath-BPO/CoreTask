import { WorkspaceRole } from '@coretask/contracts';
import type { DeleteWorkspacePayload } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { EmailQueue } from '../../jobs/email/email.queue';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ReauthService } from '../auth/reauth.service';
import { SlackService } from '../slack/slack.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

import { workspaceDeletedEmail } from './deletion-emails';

/** What a deletion took with it, for the caller to tell people about. */
export interface PurgedWorkspace {
  id: string;
  name: string;
  /** The people who were in it, service accounts left out. */
  peopleIds: string[];
}

/**
 * Deleting a workspace, for good.
 *
 * The database does the bulk of it: every table that belongs to a workspace
 * hangs off it with ON DELETE CASCADE, directly or through a project, task or
 * rule, so one DELETE takes the lot — projects to webhook deliveries.
 * `workspace-deletion.e2e-spec.ts` fills a workspace with one of everything
 * and checks that every table is back where it started, which is what keeps
 * that true as tables are added.
 *
 * What the database cannot reach is done around that DELETE: the files in
 * storage, the hidden accounts behind the workspace's API keys, the Slack
 * token, and open sockets.
 */
@Injectable()
export class WorkspaceDeletionService {
  private readonly logger = new Logger(WorkspaceDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: WorkspaceMembersService,
    private readonly reauth: ReauthService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
    private readonly slack: SlackService,
    private readonly emailQueue: EmailQueue,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `DELETE /workspaces/:id`: the owner only, with the name typed back and
   * proof it is them. The name first — a slip there is the likelier mistake,
   * and it costs nothing to check.
   */
  async deleteAsOwner(
    workspaceId: string,
    actor: { id: string; sessionId: string | null },
    input: DeleteWorkspacePayload,
  ): Promise<void> {
    await this.members.requireRole(workspaceId, actor.id, WorkspaceRole.OWNER);

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true },
    });
    if (input.confirmation !== workspace.name) {
      throw AppException.badRequest('CONFIRMATION_MISMATCH');
    }

    const owner = await this.reauth.assert(actor.id, actor.sessionId, input);
    const purged = await this.purge(workspaceId, actor.id);

    await this.tellPeople(
      purged,
      purged.peopleIds.filter((id) => id !== actor.id),
      owner.name,
    );
  }

  /**
   * Deletes the workspace and everything in it. Shared with account deletion,
   * which deletes the workspaces nobody else is in this way.
   *
   * `aloneAs`, when given, makes it refuse a workspace that has anyone in it
   * but that person — checked inside the transaction, so somebody accepting an
   * invitation a moment before cannot have their new workspace deleted under
   * them.
   */
  async purge(
    workspaceId: string,
    actorId: string,
    options: { aloneAs?: string } = {},
  ): Promise<PurgedWorkspace> {
    // Before the rows go, while the token can still be read: an uninstalled
    // app should not keep a working bot token in Slack.
    await this.disconnectSlack(workspaceId, actorId);

    const purged = await this.prisma.$transaction(
      async (tx) => {
        const workspace = await tx.workspace.findUnique({
          where: { id: workspaceId },
          select: { id: true, name: true },
        });
        if (!workspace) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Workspace not found.');

        const memberships = await tx.workspaceMember.findMany({
          where: { workspaceId },
          select: { userId: true, user: { select: { isServiceAccount: true } } },
        });
        const peopleIds = memberships
          .filter((membership) => !membership.user.isServiceAccount)
          .map((membership) => membership.userId);

        if (options.aloneAs && peopleIds.some((id) => id !== options.aloneAs)) {
          throw AppException.conflict('ACCOUNT_OWNS_SHARED_WORKSPACES');
        }

        const attachments = await tx.attachment.findMany({
          where: { workspaceId },
          select: { objectKey: true },
        });
        // Revoked keys too: their accounts stay behind for the history, and
        // the history is about to go.
        const keys = await tx.apiKey.findMany({ where: { workspaceId }, select: { userId: true } });
        const serviceAccountIds = keys.map((key) => key.userId);

        await tx.workspace.delete({ where: { id: workspaceId } });

        /*
         * The hidden accounts behind the workspace's API keys. The cascade
         * takes the keys and memberships but not the users, which would be
         * left as accounts that belong nowhere. Each one only ever acted in
         * this workspace, so what it wrote has just been deleted with it —
         * but tasks and goals hold their creator with RESTRICT, so an account
         * still named by one elsewhere is switched off rather than deleted.
         */
        await tx.user.deleteMany({
          where: {
            id: { in: serviceAccountIds },
            isServiceAccount: true,
            createdTasks: { none: {} },
            createdGoals: { none: {} },
            createdWorkspaces: { none: {} },
          },
        });
        await tx.user.updateMany({
          where: { id: { in: serviceAccountIds }, isServiceAccount: true },
          data: { isActive: false },
        });

        return {
          id: workspace.id,
          name: workspace.name,
          peopleIds,
          memberIds: memberships.map((membership) => membership.userId),
          objectKeys: attachments.map((attachment) => attachment.objectKey),
        };
      },
      // A workspace with years in it is a big cascade.
      { timeout: 120_000, maxWait: 10_000 },
    );

    // Membership is checked when a socket joins a room and never again, so
    // open tabs would otherwise keep listening to a workspace that is gone.
    await Promise.all(
      purged.memberIds.map((userId) => this.realtime.evictFromWorkspace(workspaceId, userId)),
    );

    const failed = await this.deleteFiles(workspaceId, purged.objectKeys);

    this.logger.warn(
      {
        workspaceId,
        actorId,
        members: purged.memberIds.length,
        files: purged.objectKeys.length,
        filesNotDeleted: failed,
      },
      'Workspace deleted',
    );

    return { id: purged.id, name: purged.name, peopleIds: purged.peopleIds };
  }

  /**
   * Best effort, after the rows are gone: a file nobody can reach any more
   * is a cost, not a reason to undo the deletion. The prefix listing also
   * catches what no row named — an upload that landed after its attachment
   * was removed.
   */
  private async deleteFiles(workspaceId: string, objectKeys: string[]): Promise<number> {
    try {
      const stray = await this.storage.listObjectKeys(`workspaces/${workspaceId}/`);
      const { failed } = await this.storage.deleteObjects([...objectKeys, ...stray]);
      return failed;
    } catch (error) {
      this.logger.error({ err: error, workspaceId }, 'Could not delete a workspace’s files');
      return objectKeys.length;
    }
  }

  private async disconnectSlack(workspaceId: string, actorId: string): Promise<void> {
    const installation = await this.prisma.slackInstallation.findUnique({
      where: { workspaceId },
      select: { id: true },
    });
    if (!installation) return;

    try {
      await this.slack.disconnect(workspaceId, { userId: actorId, role: WorkspaceRole.OWNER });
    } catch (error) {
      // The cascade forgets the installation either way.
      this.logger.warn({ err: error, workspaceId }, 'Could not disconnect Slack first');
    }
  }

  /** A short note to everyone else who was in it. Never throws. */
  private async tellPeople(
    workspace: PurgedWorkspace,
    userIds: string[],
    deletedBy: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    try {
      const people = await this.prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true, deletedAt: null },
        select: { email: true, name: true },
      });
      const webUrl = this.config.corsOrigins[0] ?? this.config.http.webUrl;
      await Promise.all(
        people.map((person) => {
          const message = workspaceDeletedEmail({
            to: person.email,
            name: person.name,
            workspaceName: workspace.name,
            deletedBy,
            webUrl,
          });
          return this.emailQueue.enqueueMessage({
            to: message.to,
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          });
        }),
      );
    } catch (error) {
      this.logger.error({ err: error, workspaceId: workspace.id }, 'Could not tell members');
    }
  }
}
