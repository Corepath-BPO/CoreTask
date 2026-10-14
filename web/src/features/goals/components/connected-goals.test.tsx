import type { Goal } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent } from '@/test/test-utils';

import { ConnectedGoals } from './connected-goals';

const mutate = vi.fn();
let goals: Goal[] = [];

vi.mock('../hooks/use-goals', () => ({
  useGoals: () => ({ data: goals }),
  useGoalProjectLink: () => ({ mutate }),
}));

const goal = (id: string, name: string, projectIds: string[]): Goal =>
  ({
    id,
    name,
    status: 'ON_TRACK',
    progress: 40,
    projects: projectIds.map((projectId) => ({
      id: projectId,
      name: 'P',
      color: '#000',
      completion: 0,
    })),
  }) as Goal;

beforeEach(() => {
  mutate.mockReset();
  goals = [goal('g-1', 'Fill every vacancy', ['p-1']), goal('g-2', 'Cut turnover', [])];
});

describe('ConnectedGoals', () => {
  it('lists the goals a project moves, and lets a member let one go', async () => {
    await renderWithRouter(() => <ConnectedGoals workspaceId="ws-1" projectId="p-1" canConnect />);

    expect(await screen.findByRole('link', { name: 'Fill every vacancy' })).toHaveAttribute(
      'href',
      '/goals?goal=g-1',
    );
    expect(screen.queryByText('Cut turnover')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect “Fill every vacancy”' }));
    expect(mutate).toHaveBeenCalledWith({ goalId: 'g-1', projectId: 'p-1', linked: false });
    expect(screen.getByRole('combobox', { name: 'Connect a goal' })).toBeVisible();
  });

  it('only reads for someone who cannot connect', async () => {
    await renderWithRouter(() => (
      <ConnectedGoals workspaceId="ws-1" projectId="p-1" canConnect={false} />
    ));

    await screen.findByRole('link', { name: 'Fill every vacancy' });
    expect(screen.queryByRole('button', { name: /Disconnect/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Connect a goal' })).toBeNull();
  });
});
