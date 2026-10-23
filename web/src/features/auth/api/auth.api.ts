import { ApiRoutes } from '@coretask/contracts';
import type {
  AccountSession,
  AuthSession,
  AuthUser,
  ConfirmEmailChangeResult,
  EnableTwoFactorPayload,
  LoginPayload,
  PendingEmailChange,
  ReauthPayload,
  RegisterPayload,
  RequestEmailChangePayload,
  ResendVerificationResult,
  RevokeSessionsResult,
  TwoFactorChallenge,
  TwoFactorRecoveryCodes,
  TwoFactorSetup,
  TwoFactorStatus,
  VerifyEmailResult,
  VerifyTwoFactorPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

/** What signing in answers: a session, or — with two-step verification on — a challenge. */
export type LoginResult = AuthSession | TwoFactorChallenge;

export function isTwoFactorChallenge(result: LoginResult): result is TwoFactorChallenge {
  return typeof result === 'object' && result !== null && 'twoFactorRequired' in result;
}

export const authApi = {
  register: (payload: RegisterPayload): Promise<AuthSession> =>
    apiClient.post<AuthSession>(ApiRoutes.auth.register, payload),

  login: (payload: LoginPayload): Promise<LoginResult> =>
    apiClient.post<LoginResult>(ApiRoutes.auth.login, payload),

  /** The second step of signing in: the challenge, and a code or a recovery code. */
  verifyTwoFactor: (payload: VerifyTwoFactorPayload): Promise<AuthSession> =>
    apiClient.post<AuthSession>(ApiRoutes.auth.twoFactor.verify, payload),

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

  pendingEmailChange: (): Promise<PendingEmailChange | null> =>
    apiClient.get<PendingEmailChange | null>(ApiRoutes.auth.emailChange),

  requestEmailChange: (payload: RequestEmailChangePayload): Promise<PendingEmailChange> =>
    apiClient.post<PendingEmailChange>(ApiRoutes.auth.emailChange, payload),

  cancelEmailChange: (): Promise<void> => apiClient.delete<void>(ApiRoutes.auth.emailChange),

  /** Public: the link may be opened while signed out. */
  confirmEmailChange: (token: string): Promise<ConfirmEmailChangeResult> =>
    apiClient.post<ConfirmEmailChangeResult>(ApiRoutes.auth.confirmEmailChange, { token }),

  sessions: (): Promise<AccountSession[]> =>
    apiClient.get<AccountSession[]>(ApiRoutes.auth.sessions),

  revokeSession: (sessionId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.auth.session(sessionId)),

  revokeOtherSessions: (): Promise<RevokeSessionsResult> =>
    apiClient.post<RevokeSessionsResult>(ApiRoutes.auth.revokeOtherSessions),

  twoFactorStatus: (): Promise<TwoFactorStatus> =>
    apiClient.get<TwoFactorStatus>(ApiRoutes.auth.twoFactor.status),

  setupTwoFactor: (): Promise<TwoFactorSetup> =>
    apiClient.post<TwoFactorSetup>(ApiRoutes.auth.twoFactor.setup),

  enableTwoFactor: (payload: EnableTwoFactorPayload): Promise<TwoFactorRecoveryCodes> =>
    apiClient.post<TwoFactorRecoveryCodes>(ApiRoutes.auth.twoFactor.enable, payload),

  disableTwoFactor: (payload: ReauthPayload): Promise<void> =>
    apiClient.post<void>(ApiRoutes.auth.twoFactor.disable, payload),

  regenerateRecoveryCodes: (payload: ReauthPayload): Promise<TwoFactorRecoveryCodes> =>
    apiClient.post<TwoFactorRecoveryCodes>(ApiRoutes.auth.twoFactor.recoveryCodes, payload),
};
