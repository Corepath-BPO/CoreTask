import { ApiRoutes } from '@coretask/contracts';
import type {
  CompleteSlackInstallPayload,
  SlackChannel,
  SlackInstallResult,
  SlackInstallUrl,
  SlackLinkPreview,
  SlackLinkResult,
  SlackStatus,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

const routes = ApiRoutes.slack;

export const slackApi = {
  status: (workspaceId: string): Promise<SlackStatus> =>
    apiClient.get<SlackStatus>(routes.status(workspaceId)),

  installUrl: (workspaceId: string): Promise<SlackInstallUrl> =>
    apiClient.post<SlackInstallUrl>(routes.install(workspaceId), {}),

  completeInstall: (payload: CompleteSlackInstallPayload): Promise<SlackInstallResult> =>
    apiClient.post<SlackInstallResult>(routes.complete, payload),

  disconnect: (workspaceId: string): Promise<void> =>
    apiClient.delete<void>(routes.status(workspaceId)),

  channels: (workspaceId: string): Promise<SlackChannel[]> =>
    apiClient.get<SlackChannel[]>(routes.channels(workspaceId)),

  unlinkMe: (workspaceId: string): Promise<void> =>
    apiClient.delete<void>(routes.myLink(workspaceId)),

  previewLink: (token: string): Promise<SlackLinkPreview> =>
    apiClient.post<SlackLinkPreview>(routes.linkPreview, { token }),

  link: (token: string): Promise<SlackLinkResult> =>
    apiClient.post<SlackLinkResult>(routes.link, { token }),
};
