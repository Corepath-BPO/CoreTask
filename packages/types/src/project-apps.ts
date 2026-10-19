import type { ProjectApp, ProjectAppEvent, WebhookDeliveryStatus } from '@coretask/contracts';

/** A chat app a project posts to, as Customize › Apps lists it. */
export interface ProjectAppConnection {
  id: string;
  app: ProjectApp;
  /** What the channel is called, as whoever connected it put it. */
  name: string;
  /** The webhook's host and the end of its path — enough to tell two apart. */
  urlHint: string;
  /**
   * Set when the CoreTask Slack app posts to this channel itself, rather
   * than through an incoming webhook: its posts carry buttons.
   */
  slackChannel: { id: string; name: string } | null;
  events: ProjectAppEvent[];
  enabled: boolean;
  /** Set when posting kept failing and the app switched itself off. */
  disabledReason: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: WebhookDeliveryStatus | null;
  lastSuccessAt: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface CreateProjectAppPayload {
  app: ProjectApp;
  /** The tool's incoming-webhook URL. Not needed with `slackChannelId`. */
  url?: string;
  /** Slack only, with the workspace's Slack app installed: post as the app here. */
  slackChannelId?: string;
  name?: string;
  events?: ProjectAppEvent[];
}

export interface UpdateProjectAppPayload {
  name?: string;
  events?: ProjectAppEvent[];
  enabled?: boolean;
}
