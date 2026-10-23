import type { AuthUser } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { paste, setupUser } from '@/test/test-utils';

import { ProfileCard } from './profile-card';

const mutate = vi.fn();

vi.mock('../hooks/use-profile', () => ({
  useUpdateProfile: () => ({ mutate, isPending: false }),
}));

// The picture has its own tests (profile-picture.test.tsx).
vi.mock('../hooks/use-avatar', () => ({
  useUploadAvatar: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveAvatar: () => ({ mutate: vi.fn(), isPending: false }),
}));

const profile: AuthUser = {
  id: 'u-1',
  email: 'bea@example.com',
  name: 'Bea Lin',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: true,
  emailVerificationDueAt: null,
  hasPassword: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  pronouns: 'she/her',
  jobTitle: null,
  department: null,
  aboutMe: null,
  outOfOffice: null,
};

beforeEach(() => mutate.mockReset());

describe('ProfileCard', () => {
  it('saves only once something changed, with the time off when it is on', async () => {
    const user = setupUser();
    render(<ProfileCard user={profile} />);

    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();

    // Pasted, not typed: typing re-renders the card per keystroke, which pushed
    // this journey past the timeout under the full parallel suite.
    await paste(user, screen.getByLabelText('Job title'), 'Leasing manager');
    await user.click(screen.getByRole('switch'));
    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2026-10-19');
    await user.clear(screen.getByLabelText('Until'));
    await user.type(screen.getByLabelText('Until'), '2026-10-23');
    await user.click(save);

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bea Lin',
        jobTitle: 'Leasing manager',
        pronouns: 'she/her',
        outOfOffice: { from: '2026-10-19', until: '2026-10-23', note: null },
      }),
    );
  });

  it('will not save time off that ends before it starts, or an empty name', async () => {
    const user = setupUser();
    render(<ProfileCard user={profile} />);

    await user.click(screen.getByRole('switch'));
    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2026-10-23');
    await user.clear(screen.getByLabelText('Until'));
    await user.type(screen.getByLabelText('Until'), '2026-10-19');
    expect(screen.getByText('Time off has to end on or after it starts.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();

    await user.click(screen.getByRole('switch'));
    await user.clear(screen.getByLabelText('Name'));
    expect(screen.getByText('Your name cannot be empty.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });
});
