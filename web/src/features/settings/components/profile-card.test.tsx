import type { AuthUser } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileCard } from './profile-card';

const mutate = vi.fn();

vi.mock('../hooks/use-profile', () => ({
  useUpdateProfile: () => ({ mutate, isPending: false }),
}));

const user: AuthUser = {
  id: 'u-1',
  email: 'bea@example.com',
  name: 'Bea Lin',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: true,
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
    render(<ProfileCard user={user} />);

    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Job title'), 'Leasing manager');
    await userEvent.click(screen.getByRole('switch'));
    await userEvent.clear(screen.getByLabelText('From'));
    await userEvent.type(screen.getByLabelText('From'), '2026-10-19');
    await userEvent.clear(screen.getByLabelText('Until'));
    await userEvent.type(screen.getByLabelText('Until'), '2026-10-23');
    await userEvent.click(save);

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
    render(<ProfileCard user={user} />);

    await userEvent.click(screen.getByRole('switch'));
    await userEvent.clear(screen.getByLabelText('From'));
    await userEvent.type(screen.getByLabelText('From'), '2026-10-23');
    await userEvent.clear(screen.getByLabelText('Until'));
    await userEvent.type(screen.getByLabelText('Until'), '2026-10-19');
    expect(screen.getByText('Time off has to end on or after it starts.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();

    await userEvent.click(screen.getByRole('switch'));
    await userEvent.clear(screen.getByLabelText('Name'));
    expect(screen.getByText('Your name cannot be empty.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });
});
