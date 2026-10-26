import type { AuthUser } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';
import { renderWithRouter, screen, setupUser } from '@/test/test-utils';

import { UserMenu } from './user-menu';

vi.mock('@/features/auth/hooks/use-auth', () => ({
  useAuth: () => ({ signOut: vi.fn(), logout: { isPending: false } }),
}));

const account: AuthUser = {
  id: 'u-1',
  email: 'ada@coretask.org',
  name: 'Ada Lovelace',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: true,
  emailVerificationDueAt: null,
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
  useAuthStore.setState({ status: 'authenticated', user: account });
});

describe('UserMenu', () => {
  it('offers a way to reach support by e-mail', async () => {
    const user = setupUser();
    await renderWithRouter(() => <UserMenu />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(screen.getByRole('menuitem', { name: /contact support/i })).toHaveAttribute(
      'href',
      'mailto:support@coretask.org',
    );
  });
});
