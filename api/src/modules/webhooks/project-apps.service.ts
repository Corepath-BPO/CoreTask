import {
  ActivityAction,
  ActivityEntity,
  DEFAULT_PROJECT_APP_EVENTS,
  MAX_APPS_PER_PROJECT,
  PROJECT_APP_INFO,
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
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import { deriveKey, encryptSecret, generateWebhookSecret } from './lib/secret-cipher';
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
  return {
    id: row.id,
    app: row.app as ProjectApp,
    name: row.name,
    urlHint: urlHint(row.url),
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
 * to send the project's goings-on anywhere else.
 */
@Injectable()
export class ProjectAppsService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityLogsService,
    private readonly deliveries: WebhookDeliveryService,
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
    const url = payload.url.trim();

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
    await this.requireApp(projectId, appId);
    if (payload.events !== undefined && payload.events.length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Choose at least one thing to post.');
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
