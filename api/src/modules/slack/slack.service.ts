import {
  ActivityAction,
  ActivityEntity,
  hasAtLeastRole,
  ProjectApp,
  SLACK_BOT_SCOPES,
  SLACK_INSTALL_STATE_TTL_SECONDS,
  SLACK_LINK_TTL_SECONDS,
  WorkspaceRole,
} from '@coretask/contracts';
import type {
  CompleteSlackInstallPayload,
  SlackChannel,
  SlackInstallResult,
  SlackInstallUrl,
  SlackLinkPreview,
  SlackLinkResult,
  SlackStatus,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { SlackInstallation } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { openToken, sealToken } from '../../common/utils/sealed-token';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { SlackApiClient, SlackApiError } from '../../integrations/slack/slack-api.client';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { decryptSecret, deriveKey, encryptSecret } from '../webhooks/lib/secret-cipher';

const INSTALL_PURPOSE = 'slack-install';
const LINK_PURPOSE = 'slack-link';

interface InstallState {
  workspaceId: string;
  userId: string;
}

interface LinkClaim {
  installationId: string;
  slackUserId: string;
}

/**
 * The Slack app's footing in a workspace: installing and removing it, and
 * the links between Slack accounts and CoreTask people.
 *
 * An install starts with a CoreTask admin and comes back through their
 * browser to a page that posts the code with their session, which is what
 * proves the person finishing it is the one who started it. A link starts in
 * Slack — a button only that Slack user sees — and finishes the same way: the
 * signed claim says which Slack account, the session says which person.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly tokenKey: Buffer;
  private readonly sealKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly slack: SlackApiClient,
    private readonly activity: ActivityLogsService,
  ) {
    const material = config.webhooks.encryptionKeyMaterial;
    this.tokenKey = deriveKey(material);
    this.sealKey = deriveKey(`${material}:slack-tokens`);
  }

  get webUrl(): string {
    return this.config.corsOrigins[0] ?? this.config.http.webUrl;
  }

  async status(workspaceId: string, actor: ActorContext): Promise<SlackStatus> {
    const installation = await this.prisma.slackInstallation.findUnique({
      where: { workspaceId },
      include: {
        installedBy: { select: { id: true, name: true } },
        _count: { select: { links: true } },
        links: { where: { userId: actor.userId }, select: { slackUserId: true } },
      },
    });
    const mine = installation?.links[0] ?? null;
    return {
      configured: this.config.slack.enabled,
      installation: installation
        ? {
            teamId: installation.teamId,
            teamName: installation.teamName,
            installedBy: installation.installedBy,
            installedAt: installation.createdAt.toISOString(),
            linkedPeople: installation._count.links,
          }
        : null,
      me: { linked: Boolean(mine), slackUserId: mine?.slackUserId ?? null },
      canManage: hasAtLeastRole(actor.role, WorkspaceRole.ADMIN),
    };
  }

  /** "Add to Slack": Slack's consent page, with a state only this admin can finish. */
  installUrl(workspaceId: string, userId: string): SlackInstallUrl {
    const { clientId, authorizeUrl, redirectUri } = this.requireConfigured();
    const state = sealToken<InstallState>(
      this.sealKey,
      INSTALL_PURPOSE,
      { workspaceId, userId },
      SLACK_INSTALL_STATE_TTL_SECONDS,
    );
    const url = new URL(authorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return { url: url.toString() };
  }

  /**
   * The code Slack sent back, exchanged for the bot token. Reinstalling into
   * the same Slack workspace refreshes the token and scopes; a different one
   * is refused until this one is disconnected, and a Slack workspace already
   * serving another CoreTask workspace is refused outright — a command there
   * has to know which workspace it means.
   */
  async completeInstall(
    userId: string,
    payload: CompleteSlackInstallPayload,
  ): Promise<SlackInstallResult> {
    this.requireConfigured();
    const state = openToken<InstallState>(this.sealKey, INSTALL_PURPOSE, payload.state);
    if (!state || state.userId !== userId) {
      throw AppException.badRequest('SLACK_INSTALL_INVALID');
    }
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: state.workspaceId, userId },
        deactivatedAt: null,
      },
      select: { role: true },
    });
    if (!membership || !hasAtLeastRole(membership.role, WorkspaceRole.ADMIN)) {
      throw AppException.forbidden('INSUFFICIENT_WORKSPACE_ROLE');
    }

    let access;
    try {
      access = await this.slack.oauthAccess(payload.code);
    } catch (error) {
      if (error instanceof SlackApiError && !error.retryable) {
        // invalid_code, code_already_used, bad_redirect_uri: the link is spent.
        throw AppException.badRequest('SLACK_INSTALL_INVALID');
      }
      throw AppException.serviceUnavailable('SLACK_UNAVAILABLE');
    }

    const [current, elsewhere] = await Promise.all([
      this.prisma.slackInstallation.findUnique({ where: { workspaceId: state.workspaceId } }),
      this.prisma.slackInstallation.findUnique({
        where: { teamId: access.team.id },
        include: { workspace: { select: { name: true } } },
      }),
    ]);
    if (elsewhere && elsewhere.workspaceId !== state.workspaceId) {
      throw AppException.conflict(
        'SLACK_ALREADY_CONNECTED',
        `${access.team.name} is already connected to the CoreTask workspace “${elsewhere.workspace.name}”. Disconnect it there first.`,
      );
    }
    if (current && current.teamId !== access.team.id) {
      throw AppException.conflict(
        'SLACK_ALREADY_CONNECTED',
        `This workspace is connected to ${current.teamName}. Disconnect it before connecting ${access.team.name}.`,
      );
    }

    const data = {
      teamName: access.team.name.slice(0, 200),
      botUserId: access.botUserId,
      botToken: encryptSecret(access.accessToken, this.tokenKey),
      scopes: access.scopes,
    };
    const installation = await this.prisma.slackInstallation.upsert({
      where: { workspaceId: state.workspaceId },
      create: {
        workspaceId: state.workspaceId,
        teamId: access.team.id,
        installedById: userId,
        ...data,
      },
      update: data,
    });

    // Whoever approved it in Slack is, plainly, the admin who started it.
    if (access.authedUserId) {
      await this.saveLink(installation.id, access.authedUserId, userId);
    }

    if (!current) {
      await this.activity.record({
        workspaceId: state.workspaceId,
        actorId: userId,
        action: ActivityAction.CREATED,
        entity: ActivityEntity.WORKSPACE,
        entityId: state.workspaceId,
        summary: `Connected Slack (${installation.teamName})`,
        metadata: { teamId: installation.teamId, scopes: installation.scopes },
      });
    }

    return { workspaceId: state.workspaceId, teamName: installation.teamName };
  }

  /**
   * Takes the app out of Slack and forgets it here. The links go with it;
   * the channels the bot posted to stay listed in their projects but switch
   * off, saying why, so an editor can see what stopped and reconnect.
   */
  async disconnect(workspaceId: string, actor: ActorContext): Promise<void> {
    const installation = await this.requireInstallation(workspaceId);

    try {
      await this.slack.revoke(this.botToken(installation));
    } catch (error) {
      // Already uninstalled from Slack's side, most likely; forget it all the same.
      this.logger.warn(
        { workspaceId, err: error instanceof Error ? error.message : String(error) },
        'Could not revoke the Slack bot token',
      );
    }

    await this.prisma.$transaction([
      this.prisma.webhookEndpoint.updateMany({
        where: { workspaceId, app: ProjectApp.SLACK, slackChannelId: { not: null } },
        data: { enabled: false, disabledReason: 'Slack was disconnected from this workspace.' },
      }),
      this.prisma.slackInstallation.delete({ where: { id: installation.id } }),
    ]);

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Disconnected Slack (${installation.teamName})`,
      metadata: { teamId: installation.teamId },
    });
  }

  async channels(workspaceId: string): Promise<SlackChannel[]> {
    const installation = await this.requireInstallation(workspaceId);
    try {
      const channels = await this.slack.listChannels(this.botToken(installation));
      return channels
        .filter((channel) => !channel.is_archived)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          isPrivate: Boolean(channel.is_private),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  /** The bot's view of one channel, for an app being connected to it. */
  async channel(workspaceId: string, channelId: string): Promise<SlackChannel> {
    const installation = await this.requireInstallation(workspaceId);
    try {
      const channel = await this.slack.channelInfo(this.botToken(installation), channelId);
      return { id: channel.id, name: channel.name, isPrivate: Boolean(channel.is_private) };
    } catch (error) {
      if (error instanceof SlackApiError && error.error === 'channel_not_found') {
        throw AppException.badRequest(
          'BAD_REQUEST',
          'The CoreTask app cannot see that channel. For a private channel, invite the app first.',
        );
      }
      throw this.unavailable(error);
    }
  }

  async unlinkMe(workspaceId: string, userId: string): Promise<void> {
    const installation = await this.requireInstallation(workspaceId);
    await this.prisma.slackUserLink.deleteMany({
      where: { installationId: installation.id, userId },
    });
  }

  // ---- linking ------------------------------------------------------------

  /** The address a "Link your account" button opens, for this Slack user only. */
  linkUrl(installation: Pick<SlackInstallation, 'id'>, slackUserId: string): string {
    const token = sealToken<LinkClaim>(
      this.sealKey,
      LINK_PURPOSE,
      { installationId: installation.id, slackUserId },
      SLACK_LINK_TTL_SECONDS,
    );
    return `${this.webUrl}/integrations/slack/link?token=${encodeURIComponent(token)}`;
  }

  async previewLink(userId: string, token: string): Promise<SlackLinkPreview> {
    const { installation } = await this.openLink(userId, token);
    const claim = openToken<LinkClaim>(this.sealKey, LINK_PURPOSE, token) as LinkClaim;
    const existing = await this.prisma.slackUserLink.findUnique({
      where: {
        installationId_slackUserId: {
          installationId: installation.id,
          slackUserId: claim.slackUserId,
        },
      },
      select: { user: { select: { id: true, name: true } } },
    });
    return {
      workspaceId: installation.workspaceId,
      workspaceName: installation.workspace.name,
      teamName: installation.teamName,
      linkedTo: existing?.user ?? null,
    };
  }

  /**
   * Links the Slack account in the claim to the signed-in person. Either
   * side's earlier link is replaced: one Slack account is one person, and one
   * person has one Slack account per Slack workspace.
   */
  async link(userId: string, token: string): Promise<SlackLinkResult> {
    const { installation, claim } = await this.openLink(userId, token);
    await this.saveLink(installation.id, claim.slackUserId, userId);
    return { workspaceId: installation.workspaceId, teamName: installation.teamName };
  }

  // ---- for the interactions service ----------------------------------------

  findByTeam(teamId: string) {
    return this.prisma.slackInstallation.findUnique({ where: { teamId } });
  }

  botToken(installation: Pick<SlackInstallation, 'botToken'>): string {
    return decryptSecret(installation.botToken, this.tokenKey);
  }

  // -------------------------------------------------------------------------

  private async openLink(userId: string, token: string) {
    const claim = openToken<LinkClaim>(this.sealKey, LINK_PURPOSE, token);
    if (!claim) throw AppException.badRequest('SLACK_LINK_INVALID');
    const installation = await this.prisma.slackInstallation.findUnique({
      where: { id: claim.installationId },
      include: { workspace: { select: { name: true } } },
    });
    if (!installation) throw AppException.badRequest('SLACK_LINK_INVALID');

    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: installation.workspaceId, userId },
        deactivatedAt: null,
      },
      select: { id: true },
    });
    if (!member) {
      throw AppException.forbidden(
        'WORKSPACE_ACCESS_DENIED',
        `You are not a member of ${installation.workspace.name}, the CoreTask workspace this Slack is connected to.`,
      );
    }
    return { installation, claim };
  }

  private async saveLink(installationId: string, slackUserId: string, userId: string) {
    await this.prisma.$transaction([
      this.prisma.slackUserLink.deleteMany({
        where: { installationId, OR: [{ slackUserId }, { userId }] },
      }),
      this.prisma.slackUserLink.create({ data: { installationId, slackUserId, userId } }),
    ]);
  }

  private requireConfigured() {
    const slack = this.config.slack;
    if (!slack.enabled || !slack.clientId) {
      throw AppException.badRequest('SLACK_NOT_CONFIGURED');
    }
    return { ...slack, clientId: slack.clientId };
  }

  private async requireInstallation(workspaceId: string): Promise<SlackInstallation> {
    const installation = await this.prisma.slackInstallation.findUnique({
      where: { workspaceId },
    });
    if (!installation) throw AppException.notFound('SLACK_NOT_CONNECTED');
    return installation;
  }

  private unavailable(error: unknown): AppException {
    this.logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Slack call failed',
    );
    return AppException.serviceUnavailable('SLACK_UNAVAILABLE');
  }
}
