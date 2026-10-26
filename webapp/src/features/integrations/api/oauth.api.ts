import { ApiRoutes } from '@coretask/contracts';
import type {
  ApproveWorkspaceAppPayload,
  ConnectedApp,
  CreateOAuthAppPayload,
  CreatedOAuthApp,
  DirectoryApp,
  OAuthApp,
  OAuthAuthorizationRequest,
  OAuthConsent,
  OAuthDecision,
  OAuthRedirect,
  OAuthSecretRotation,
  UpdateAppPolicyPayload,
  UpdateOAuthAppPayload,
  WorkspaceAppDirectory,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const oauthApi = {
  apps: (): Promise<OAuthApp[]> => apiClient.get<OAuthApp[]>(ApiRoutes.oauth.apps),

  /** The only response besides a rotation carrying the client secret. Never cache it. */
  createApp: (payload: CreateOAuthAppPayload): Promise<CreatedOAuthApp> =>
    apiClient.post<CreatedOAuthApp>(ApiRoutes.oauth.apps, payload),

  updateApp: (appId: string, payload: UpdateOAuthAppPayload): Promise<OAuthApp> =>
    apiClient.patch<OAuthApp>(ApiRoutes.oauth.app(appId), payload),

  rotateSecret: (appId: string): Promise<OAuthSecretRotation> =>
    apiClient.post<OAuthSecretRotation>(ApiRoutes.oauth.rotateSecret(appId), {}),

  deleteApp: (appId: string): Promise<void> => apiClient.delete<void>(ApiRoutes.oauth.app(appId)),

  connectedApps: (): Promise<ConnectedApp[]> =>
    apiClient.get<ConnectedApp[]>(ApiRoutes.oauth.connectedApps),

  disconnect: (appId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.oauth.connectedApp(appId)),

  consent: (request: OAuthAuthorizationRequest): Promise<OAuthConsent> =>
    apiClient.post<OAuthConsent>(ApiRoutes.oauth.consent, request),

  authorize: (decision: OAuthDecision): Promise<OAuthRedirect> =>
    apiClient.post<OAuthRedirect>(ApiRoutes.oauth.authorize, decision),

  appDirectory: (workspaceId: string): Promise<WorkspaceAppDirectory> =>
    apiClient.get<WorkspaceAppDirectory>(ApiRoutes.appDirectory.root(workspaceId)),

  setAppPolicy: (
    workspaceId: string,
    payload: UpdateAppPolicyPayload,
  ): Promise<WorkspaceAppDirectory> =>
    apiClient.patch<WorkspaceAppDirectory>(ApiRoutes.appDirectory.root(workspaceId), payload),

  approveApp: (workspaceId: string, payload: ApproveWorkspaceAppPayload): Promise<DirectoryApp> =>
    apiClient.post<DirectoryApp>(ApiRoutes.appDirectory.apps(workspaceId), payload),

  removeDirectoryApp: (workspaceId: string, appId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.appDirectory.app(workspaceId, appId)),
};
