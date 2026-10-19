import {
  ActivityAction,
  ActivityEntity,
  DEFAULT_PROJECT_APP_EVENTS,
  MAX_APPS_PER_PROJECT,
  PROJECT_APP_INFO,
  ProjectApp as ProjectAppValue,
  slackChannelUrl,
  WorkspaceRole,
  appAcceptsUrl,
  type ProjectApp,
  type ProjectAppEvent,
  type WebhookDeliveryStatus,
} from '@coretask/contracts';
import type {
  CreateProjectAppPayload,
  ProjectAppConnection,
  UpdateProjectAppPayload,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { SlackApiClient, SlackApiError } from '../../integrations/slack/slack-api.client';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateWebhookSecret,
} from './lib/secret-cipher';
import { assertDeliverableUrl } from './lib/url-policy';
import { WebhookDeliveryService } from './webhook-delivery.service';

const appInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.WebhookEndpointInclude;

type AppRow = Prisma.WebhookEndpointGetPayload<{ include: typeof appInclude }>;

/** The host and the last few characters of the path: never the token whole. */
function urlHint(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return path.length > 4 ? `${parsed.host}/…${path.slice(-4)}` : parsed.host;
  } catch {
    return 'webhook';
  }
}

function toDto(row: AppRow): ProjectAppConnection {
  const slackChannel = row.slackChannelId
    ? { id: row.slackChannelId, name: row.slackChannelName ?? row.slackChannelId }
    : null;
  return {
    id: row.id,
    app: row.app as ProjectApp,
    name: row.name,
    urlHint: slackChannel ? `#${slackChannel.name}` : urlHint(row.url),
    slackChannel,
    events: row.events as ProjectAppEvent[],
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryStatus: (row.lastDeliveryStatus as WebhookDeliveryStatus | null) ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Customize › Apps: chat channels a project posts its updates to.
 *
 * An app is a webhook endpoint scoped to the project, with the tool it posts
 * to, so it rides the same queue — retries, the delivery log, switching off
 * after repeated failures — and shows in the admin's webhook list too. The
 * project's editors manage its apps; they can already read what is posted.
 * The URL must be the tool's own webhook address, so an app cannot be used
 * to send the project's goings-on anywhere else. With the CoreTask Slack app
 * installed, a Slack app can name a channel instead, and the bot posts there
 * itself — with buttons, which a webhook's message cannot carry.
 */
@Injectable()
export class ProjectAppsService {
  private readonly logger = new Logger(ProjectAppsService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityLogsService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly slack: SlackApiClient,
  ) {
    this.key = deriveKey(config.webhooks.encryptionKeyMaterial);
  }

  async list(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectAppConnection[]> {
    await this.requireEditor(workspaceId, projectId, actor);
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId, projectId, app: { not: null } },
      include: appInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    payload: CreateProjectAppPayload,
  ): Promise<ProjectAppConnection> {
    const project = await this.requireEditor(workspaceId, projectId, actor);
    const info = PROJECT_APP_INFO[payload.app];
    if (payload.slackChannelId) {
      return this.createSlackChannelApp(workspaceId, project, actor, payload);
    }
    const url = payload.url?.trim() ?? '';
    if (!url) {
      throw AppException.badRequest('BAD_REQUEST', `Paste the ${info.label} webhook URL.`);
    }

    // A local catcher may stand in for the real tool where private URLs are
    // allowed (development); anywhere else it must be the tool's address.
    const allowPrivate = this.config.webhooks.allowPrivateUrls;
    if (!allowPrivate && !appAcceptsUrl(payload.app, url)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `That is not a ${info.label} webhook URL. It should look like ${info.placeholder}`,
      );
    }
    const checked = assertDeliverableUrl(url, { allowPrivate });

    const count = await this.prisma.webhookEndpoint.count({
      where: { projectId, app: { not: null } },
    });
    if (count >= MAX_APPS_PER_PROJECT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project holds up to ${MAX_APPS_PER_PROJECT} apps.`,
      );
    }

    const row = await this.prisma.webhookEndpoint.create({
      data: {
        workspaceId,
        projectId,
        app: payload.app,
        name: payload.name?.trim() || info.label,
        url: checked.toString(),
        // Chat tools verify nothing, but every endpoint is signed all the same.
        secret: encryptSecret(generateWebhookSecret(), this.key),
        events: [...new Set(payload.events?.length ? payload.events : DEFAULT_PROJECT_APP_EVENTS)],
        createdById: actor.userId,
      },
      include: appInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: row.id,
      projectId,
      summary: `Connected ${info.label} (${row.name}) to ${project.name}`,
      metadata: { app: payload.app, events: row.events, host: checked.host },
    });

    // A hello in the channel says at once whether the URL is right.
    await this.deliveries.createPing(
      row,
      actor.userId,
      `CoreTask will post updates from ${project.name} here.`,
    );
    return toDto(row);
  }

  async update(
    workspaceId: string,
    projectId: string,
    appId: string,
    actor: ActorContext,
    payload: UpdateProjectAppPayload,
  ): Promise<ProjectAppConnection> {
    await this.requireEditor(workspaceId, projectId, actor);
    const existing = await this.requireApp(projectId, appId);
    if (payload.events !== undefined && payload.events.length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Choose at least one thing to post.');
    }
    if (payload.enabled === true && existing.slackChannelId) {
      // Switched on with no app to post as, it would only fail its way off again.
      const installed = await this.prisma.slackInstallation.count({ where: { workspaceId } });
      if (installed === 0) throw AppException.badRequest('SLACK_NOT_CONNECTED');
    }
    const row = await this.prisma.webhookEndpoint.update({
      where: { id: appId },
      data: {
        ...(payload.name !== undefined ? { name: payload.name.trim() || 'App' } : {}),
        ...(payload.events !== undefined ? { events: [...new Set(payload.events)] } : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        // Switched back on, the failures that switched it off are history.
        ...(payload.enabled === true ? { consecutiveFailures: 0, disabledReason: null } : {}),
      },
      include: appInclude,
    });
    return toDto(row);
  }

  async remove(
    workspaceId: string,
    projectId: string,
    appId: string,
    actor: ActorContext,
  ): Promise<void> {
    const project = await this.requireEditor(workspaceId, projectId, actor);
    const row = await this.requireApp(projectId, appId);
    await this.prisma.webhookEndpoint.delete({ where: { id: appId } });
    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: appId,
      projectId,
      summary: `Disconnected ${PROJECT_APP_INFO[row.app as ProjectApp].label} (${row.name}) from ${project.name}`,
    });
  }

  async test(
    workspaceId: string,
    projectId: string,
    appId: string,
    actor: ActorContext,
  ): Promise<{ deliveryId: string }> {
    const project = await this.requireEditor(workspaceId, projectId, actor);
    const row = await this.requireApp(projectId, appId);
    if (!row.enabled) {
      throw AppException.badRequest('BAD_REQUEST', 'Turn the app on before sending a test.');
    }
    const deliveryId = await this.deliveries.createPing(
      row,
      actor.userId,
      `A test from CoreTask: updates from ${project.name} will appear here.`,
    );
    return { deliveryId };
  }

  // -------------------------------------------------------------------------

  /** A Slack channel the CoreTask bot posts to, checked with Slack first. */
  private async createSlackChannelApp(
    workspaceId: string,
    project: { id: string; name: string },
    actor: ActorContext,
    payload: CreateProjectAppPayload,
  ): Promise<ProjectAppConnection> {
    const channelId = payload.slackChannelId as string;
    if (payload.app !== ProjectAppValue.SLACK) {
      throw AppException.badRequest('BAD_REQUEST', 'Only Slack posts to a channel by its id.');
    }
    const installation = await this.prisma.slackInstallation.findUnique({
      where: { workspaceId },
      select: { botToken: true },
    });
    if (!installation) throw AppException.badRequest('SLACK_NOT_CONNECTED');

    let channel;
    try {
      channel = await this.slack.channelInfo(
        decryptSecret(installation.botToken, this.key),
        channelId,
      );
    } catch (error) {
      if (error instanceof SlackApiError && !error.retryable) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          'The CoreTask app cannot see that channel. For a private channel, invite the app to it first.',
        );
      }
      this.logger.warn({ err: String(error) }, 'Could not check a Slack channel');
      throw AppException.serviceUnavailable('SLACK_UNAVAILABLE');
    }

    const [count, duplicate] = await Promise.all([
      this.prisma.webhookEndpoint.count({ where: { projectId: project.id, app: { not: null } } }),
      this.prisma.webhookEndpoint.findFirst({
        where: { projectId: project.id, slackChannelId: channel.id },
        select: { id: true },
      }),
    ]);
    if (duplicate) {
      throw AppException.conflict(
        'RESOURCE_CONFLICT',
        `${project.name} already posts to #${channel.name}.`,
      );
    }
    if (count >= MAX_APPS_PER_PROJECT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project holds up to ${MAX_APPS_PER_PROJECT} apps.`,
      );
    }

    const row = await this.prisma.webhookEndpoint.create({
      data: {
        workspaceId,
        projectId: project.id,
        app: ProjectAppValue.SLACK,
        name: payload.name?.trim() || `#${channel.name}`,
        url: slackChannelUrl(channel.id),
        slackChannelId: channel.id,
        slackChannelName: channel.name.slice(0, 120),
        secret: encryptSecret(generateWebhookSecret(), this.key),
        events: [...new Set(payload.events?.length ? payload.events : DEFAULT_PROJECT_APP_EVENTS)],
        createdById: actor.userId,
      },
      include: appInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: row.id,
      projectId: project.id,
      summary: `Connected Slack (#${channel.name}) to ${project.name}`,
      metadata: { app: ProjectAppValue.SLACK, events: row.events, channel: channel.id },
    });

    await this.deliveries.createPing(
      row,
      actor.userId,
      `CoreTask will post updates from ${project.name} here.`,
    );
    return toDto(row);
  }

  private async requireEditor(workspaceId: string, projectId: string, actor: ActorContext) {
    const access = await this.access.requireAccess(
      workspaceId,
      projectId,
      actor,
      WorkspaceRole.MEMBER,
    );
    return access.project;
  }

  private async requireApp(projectId: string, appId: string) {
    const row = await this.prisma.webhookEndpoint.findFirst({
      where: { id: appId, projectId, app: { not: null } },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'App not found.');
    return row;
  }
}
