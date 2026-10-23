import { ACCOUNT_DELETION_CONFIRMATION, WorkspaceRole } from '@coretask/contracts';
import type { AccountDeletionPreview, DeleteAccountPayload } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ReauthService } from '../auth/reauth.service';
import { SecurityNotices } from '../auth/security-notices';
import { MembersService } from '../members/members.service';
import { AvatarService } from '../users/avatar.service';
import { UsersService } from '../users/users.service';

import { WorkspaceDeletionService } from './workspace-deletion.service';

/** What a deleted account is called wherever its history still shows. */
export const DELETED_USER_NAME = 'Deleted user';

/**
 * An address no one can own or receive mail at — `.invalid` is reserved, and
 * `isUndeliverableAddress` refuses it — unique per account, so the real one is
 * free to sign up with again.
 */
export function deletedUserEmail(userId: string): string {
  return `deleted+${userId}@deleted.coretask.invalid`;
}

/**
 * Deleting your own account.
 *
 * The row stays, scrubbed: tasks, comments, activity and everything else the
 * person wrote keep an author, and that author reads "Deleted user". What was
 * only theirs goes — sign-in methods, sessions, settings, notifications,
 * private views, calendar links — as do the workspaces nobody else was in.
 * Shared workspaces they own block it until handed over or deleted, since a
 * workspace with no owner has nobody who can run it.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly reauth: ReauthService,
    private readonly notices: SecurityNotices,
    private readonly members: MembersService,
    private readonly workspaces: WorkspaceDeletionService,
    private readonly avatars: AvatarService,
  ) {}

  /** What deleting would take with it, and what stands in the way. */
  async preview(userId: string): Promise<AccountDeletionPreview> {
    const user = await this.users.requireById(userId);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            _count: { select: { members: { where: { user: { isServiceAccount: false } } } } },
          },
        },
      },
    });

    const preview: AccountDeletionPreview = {
      workspacesDeleted: [],
      workspacesBlocking: [],
      workspacesLeft: [],
      reauth: ReauthService.requirementFor(user),
    };
    for (const { role, workspace } of memberships) {
      const { id, name } = workspace;
      // Counts people only: an API key's account is not someone to hand over to.
      const people = workspace._count.members;
      if (role !== WorkspaceRole.OWNER) preview.workspacesLeft.push({ id, name });
      else if (people > 1) preview.workspacesBlocking.push({ id, name, memberCount: people });
      else preview.workspacesDeleted.push({ id, name });
    }
    return preview;
  }

  /**
   * In order: the confirmation, proof it is them, nothing blocking; then
   * their own workspaces go, the others are left as "leave" would, and the
   * row is scrubbed. A notice goes to the address the account had.
   */
  async delete(
    userId: string,
    sessionId: string | null,
    input: DeleteAccountPayload,
  ): Promise<void> {
    if (input.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
      throw AppException.badRequest('CONFIRMATION_MISMATCH');
    }
    const user = await this.reauth.assert(userId, sessionId, input);

    const plan = await this.preview(userId);
    if (plan.workspacesBlocking.length > 0) {
      throw AppException.conflict('ACCOUNT_OWNS_SHARED_WORKSPACES', undefined, {
        workspaces: plan.workspacesBlocking,
      });
    }

    for (const workspace of plan.workspacesDeleted) {
      await this.workspaces.purge(workspace.id, userId, { aloneAs: userId });
    }
    for (const workspace of plan.workspacesLeft) {
      await this.members.leaveForAccountDeletion(workspace.id, userId);
    }

    const before = { email: user.email, name: user.name };
    await this.scrub(userId);
    await this.avatars.discardAll(userId, user.avatarKey);

    await this.notices.send(userId, {
      to: before,
      subject: 'Your CoreTask account was deleted',
      heading: 'Your account is deleted',
      lines: [
        `The CoreTask account for ${before.email} was deleted just now, along with ${
          plan.workspacesDeleted.length === 1
            ? 'the workspace only you were in'
            : plan.workspacesDeleted.length > 1
              ? `the ${plan.workspacesDeleted.length} workspaces only you were in`
              : 'everything that was only yours'
        }.`,
        'What you wrote in shared workspaces stays there, under the name "Deleted user". You can sign up again with this address at any time.',
      ],
      showSettingsLink: false,
    });

    this.logger.warn(
      {
        userId,
        workspacesDeleted: plan.workspacesDeleted.length,
        workspacesLeft: plan.workspacesLeft.length,
      },
      'Account deleted',
    );
  }

  /**
   * Everything personal goes; everything authored stays. Kept on purpose,
   * pointing at the scrubbed row: tasks and tickets they created or reported,
   * closed work they did, comments, likes and mentions, messages, status
   * updates, activity, time entries, goals, portfolios, dashboards, shared
   * views, fields, tags, templates, rules, API keys and webhooks they made
   * for a workspace. All of it is the workspace's record, not theirs.
   */
  private async scrub(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: deletedUserEmail(userId),
          name: DELETED_USER_NAME,
          passwordHash: null,
          avatarUrl: null,
          avatarKey: null,
          timezone: 'UTC',
          pronouns: null,
          jobTitle: null,
          department: null,
          aboutMe: null,
          outOfOfficeFrom: null,
          outOfOfficeUntil: null,
          outOfOfficeNote: null,
          emailVerifiedAt: null,
          emailVerificationDueAt: null,
          totpSecret: null,
          totpEnabledAt: null,
          totpLastStep: null,
          lastLoginAt: null,
          isActive: false,
          deletedAt: new Date(),
        },
      });

      // Ways in, and every session: the access tokens already out stop at
      // their next request, which checks the session is still open.
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.userIdentity.deleteMany({ where: { userId } });
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.emailChangeToken.deleteMany({ where: { userId } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      // Apps they allowed to act for them, and apps they registered.
      await tx.oAuthAuthorizationCode.deleteMany({ where: { userId } });
      await tx.oAuthGrant.deleteMany({ where: { userId } });
      await tx.oAuthApp.deleteMany({ where: { ownerId: userId } });
      await tx.slackUserLink.deleteMany({ where: { userId } });
      await tx.calendarFeed.deleteMany({ where: { userId } });

      // Settings, inbox and things only they could see.
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.homeLayout.deleteMany({ where: { userId } });
      await tx.savedSearch.deleteMany({ where: { userId } });
      await tx.myTaskPlacement.deleteMany({ where: { userId } });
      await tx.projectView.deleteMany({ where: { ownerUserId: userId } });
      await tx.projectStar.deleteMany({ where: { userId } });
      await tx.portfolioStar.deleteMany({ where: { userId } });
      await tx.portfolioCapacity.deleteMany({ where: { userId } });

      // Leaving each workspace already dropped these; anything a race left
      // behind would otherwise keep a deleted person on a roster.
      await tx.follower.deleteMany({ where: { userId } });
      await tx.teamMember.deleteMany({ where: { userId } });
      await tx.projectMember.deleteMany({ where: { userId } });
      await tx.workspaceMember.deleteMany({
        where: { userId, role: { not: WorkspaceRole.OWNER } },
      });
    });
  }
}
