import { ApiRoutes } from '@coretask/contracts';
import type { AuthSession, AuthUser, LoginPayload, RegisterPayload } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const authApi = {
  register: (payload: RegisterPayload): Promise<AuthSession> =>
    apiClient.post<AuthSession>(ApiRoutes.auth.register, payload),

  login: (payload: LoginPayload): Promise<AuthSession> =>
    apiClient.post<AuthSession>(ApiRoutes.auth.login, payload),

  /** Rotates the refresh cookie and returns a fresh access token. */
  refresh: (): Promise<AuthSession> => apiClient.post<AuthSession>(ApiRoutes.auth.refresh),

  logout: (): Promise<{ loggedOut: boolean }> =>
    apiClient.post<{ loggedOut: boolean }>(ApiRoutes.auth.logout),

  me: (): Promise<AuthUser> => apiClient.get<AuthUser>(ApiRoutes.auth.me),
};
