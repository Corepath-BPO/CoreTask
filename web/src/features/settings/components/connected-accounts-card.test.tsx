import { ERROR_CODE_MESSAGES } from '@coretask/contracts';
import type { AuthUser, LinkedIdentity } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, setupUser, waitFor } from '@/test/test-utils';

import { ConnectedAccountsCard } from './connected-accounts-card';

const api = {
  providers: vi.fn(),
  identities: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
};
const leaveFor = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('@/features/auth/api/sso.api', () => ({
  ssoApi: {
    providers: () => api.providers(),
    identities: () => api.identities(),
    link: (provider: string) => api.link(provider),
    unlink: (id: string) => api.unlink(id),
  },
}));
vi.mock('@/features/auth/lib/leave-for', () => ({ leaveFor: (url: string) => leaveFor(url) }));
vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
  },
}));

const account: AuthUser = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: true,
  emailVerificationDueAt: null,
  hasPassword: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  pronouns: null,
  jobTitle: null,
  department: null,
  aboutMe: null,
  outOfOffice: null,
};

const identity = (over: Partial<LinkedIdentity>): LinkedIdentity => ({
  id: 'i-1',
  provider: 'GOOGLE',
  email: 'ada@gmail.test',
  workspace: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: null,
  ...over,
});

const renderCard = (user: AuthUser = account, initialPath = '/') =>
  renderWithRouter(() => <ConnectedAccountsCard user={user} />, { initialPath });

beforeEach(() => {
  api.providers.mockResolvedValue({ google: true, microsoft: true, saml: true });
});

describe('ConnectedAccountsCard', () => {
  it('lists what is connected, and connects the rest through the provider', async () => {
    api.identities.mockResolvedValue([
      identity({}),
      identity({
        id: 'i-2',
        provider: 'SAML',
        email: 'ada@acme.com',
        workspace: { id: 'w-1', name: 'Acme' },
      }),
    ]);
    api.link.mockResolvedValue({ url: 'https://login.microsoftonline.test/authorize?x=1' });
    const user = setupUser();
    await renderCard();

    expect(await screen.findByText('ada@gmail.test')).toBeInTheDocument();
    expect(screen.getByText('Acme single sign-on')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Connect Microsoft' }));
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('https://login.microsoftonline.test/authorize?x=1'),
    );
    expect(api.link).toHaveBeenCalledWith('microsoft');
  });

  it('disconnects one', async () => {
    api.identities.mockResolvedValue([identity({})]);
    api.unlink.mockResolvedValue(undefined);
    const user = setupUser();
    await renderCard();

    await user.click(await screen.findByRole('button', { name: 'Disconnect Google' }));
    await waitFor(() => expect(api.unlink).toHaveBeenCalledWith('i-1'));
  });

  it('will not disconnect the only way into an account without a password', async () => {
    api.identities.mockResolvedValue([identity({})]);
    await renderCard({ ...account, hasPassword: false });

    expect(await screen.findByRole('button', { name: 'Disconnect Google' })).toBeDisabled();
    expect(screen.getByText(/only way you can sign in/i)).toBeInTheDocument();
  });

  it('says once how the trip to the provider went', async () => {
    api.identities.mockResolvedValue([identity({})]);
    await renderCard(account, '/?ssoLinked=google');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Google is connected.'));
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('says why connecting failed', async () => {
    api.identities.mockResolvedValue([]);
    await renderCard(account, '/?ssoError=SSO_IDENTITY_IN_USE');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ERROR_CODE_MESSAGES.SSO_IDENTITY_IN_USE),
    );
  });
});
