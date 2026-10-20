import { ApiRoutes } from '@coretask/contracts';
import type {
  AuthSession,
  AuthUser,
  LoginPayload,
  RegisterPayload,
  ResendVerificationResult,
  VerifyEmailResult,
} from '@coretask/types';

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

  /** Answers the same whether or not the address has an account. */
  forgotPassword: (email: string): Promise<{ sent: true }> =>
    apiClient.post<{ sent: true }>(ApiRoutes.auth.forgotPassword, { email }),

  resetPassword: (token: string, password: string): Promise<void> =>
    apiClient.post<void>(ApiRoutes.auth.resetPassword, { token, password }),

  /** Ends every session the account has, this one included. */
  logoutAll: (): Promise<{ loggedOut: boolean }> =>
    apiClient.post<{ loggedOut: boolean }>(ApiRoutes.auth.logoutAll),

  /** Keeps this session; signs out every other one. */
  changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
    apiClient.post<void>(ApiRoutes.auth.changePassword, { currentPassword, newPassword }),

  resendVerification: (): Promise<ResendVerificationResult> =>
    apiClient.post<ResendVerificationResult>(ApiRoutes.auth.resendVerification),

  verifyEmail: (token: string): Promise<VerifyEmailResult> =>
    apiClient.post<VerifyEmailResult>(ApiRoutes.auth.verifyEmail, { token }),
};
