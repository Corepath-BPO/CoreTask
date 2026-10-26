import type { AuthUser } from '@coretask/types';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';
import { renderWithProviders, screen, setupUser, waitFor } from '@/test/test-utils';

import type * as AuthApiModule from '../api/auth.api';
import { useEmailVerificationOverdue } from '../hooks/use-email-verification';

import { EmailVerificationGate } from './email-verification-gate';

const me = vi.fn();
const resendVerification = vi.fn();
const signOut = vi.fn();

vi.mock('../api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApiModule>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      me: () => me(),
      resendVerification: () => resendVerification(),
    },
  };
});

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ signOut }) }));

const account: AuthUser = {
  id: 'u-1',
  email: 'typo@exmaple.com',
  name: 'Ada Lovelace',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: false,
  emailVerificationDueAt: '2026-10-01T00:00:00.000Z',
  hasPassword: true,
  twoFactorEnabled: false,
  createdAt: '2026-09-24T00:00:00.000Z',
  pronouns: null,
  jobTitle: null,
  department: null,
  aboutMe: null,
  outOfOffice: null,
};

beforeEach(() => {
  me.mockReset();
  resendVerification.mockReset().mockResolvedValue({ sent: true, emailVerified: false });
  signOut.mockReset();
  useAuthStore.setState({ status: 'authenticated', user: account });
});

afterEach(() => vi.useRealTimers());

describe('useEmailVerificationOverdue', () => {
  it('is true only for an unconfirmed address past its deadline', () => {
    const past = renderHook(() => useEmailVerificationOverdue(account));
    expect(past.result.current).toBe(true);

    const confirmed = renderHook(() =>
      useEmailVerificationOverdue({ ...account, emailVerified: true }),
    );
    expect(confirmed.result.current).toBe(false);

    const later = renderHook(() =>
      useEmailVerificationOverdue({
        ...account,
        emailVerificationDueAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    expect(later.result.current).toBe(false);

    expect(renderHook(() => useEmailVerificationOverdue(null)).result.current).toBe(false);
  });
});

describe('EmailVerificationGate', () => {
  it('offers a new link, a recheck, a different address and signing out', async () => {
    me.mockResolvedValueOnce(account).mockResolvedValueOnce({
      ...account,
      emailVerified: true,
      emailVerificationDueAt: null,
    });
    renderWithProviders(<EmailVerificationGate user={account} />);
    const user = setupUser();

    expect(screen.getByText('typo@exmaple.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'I have confirmed it' }));
    await waitFor(() => expect(me).toHaveBeenCalledTimes(1));
    expect(useAuthStore.getState().user?.emailVerified).toBe(false);

    await user.click(screen.getByRole('button', { name: 'I have confirmed it' }));
    await waitFor(() => expect(useAuthStore.getState().user?.emailVerified).toBe(true));

    await user.click(screen.getByRole('button', { name: /change it/i }));
    expect(screen.getByRole('dialog', { name: /change e-mail address/i })).toBeInTheDocument();
  });
});
