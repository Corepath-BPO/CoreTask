import type { ProjectApp, ProjectAppEvent, WebhookDeliveryStatus } from '@coretask/contracts';

/** A chat app a project posts to, as Customize › Apps lists it. */
export interface ProjectAppConnection {
  id: string;
  app: ProjectApp;
  /** What the channel is called, as whoever connected it put it. */
  name: string;
  /** The webhook's host and the end of its path — enough to tell two apart. */
  urlHint: string;
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
  url: string;
  name?: string;
  events?: ProjectAppEvent[];
}

export interface UpdateProjectAppPayload {
  name?: string;
  events?: ProjectAppEvent[];
  enabled?: boolean;
}
