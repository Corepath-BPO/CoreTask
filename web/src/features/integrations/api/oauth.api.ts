import { ApiRoutes } from '@coretask/contracts';
import type {
  ConnectedApp,
  CreateOAuthAppPayload,
  CreatedOAuthApp,
  OAuthApp,
  OAuthAuthorizationRequest,
  OAuthConsent,
  OAuthDecision,
  OAuthRedirect,
  OAuthSecretRotation,
  UpdateOAuthAppPayload,
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
};
