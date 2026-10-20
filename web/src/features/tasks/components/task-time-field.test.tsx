import type { TaskTime } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { TaskTimeField } from './task-time-field';

const log = vi.fn();
const remove = vi.fn();
let time: TaskTime;

vi.mock('../hooks/use-task-time', () => ({
  useTaskTime: () => ({ data: time }),
  useLogTime: () => ({ mutate: log, isPending: false }),
  useDeleteTimeEntry: () => ({ mutate: remove, isPending: false }),
}));

const renderField = (props: Partial<Parameters<typeof TaskTimeField>[0]> = {}) => {
  const onEstimate = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskTimeField
        workspaceId="ws-1"
        taskId="t-1"
        estimatedMinutes={120}
        canEdit
        canManage={false}
        currentUserId="me"
        onEstimate={onEstimate}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onEstimate };
};

beforeEach(() => {
  log.mockReset();
  remove.mockReset();
  window.localStorage.clear();
  time = {
    totalMinutes: 150,
    estimatedMinutes: 120,
    entries: [
      {
        id: 'e-1',
        taskId: 't-1',
        minutes: 90,
        date: '2026-10-12',
        note: 'Walkthrough',
        user: { id: 'me', name: 'Me', avatarUrl: null },
        createdAt: '2026-10-12T10:00:00Z',
      },
      {
        id: 'e-2',
        taskId: 't-1',
        minutes: 60,
        date: '2026-10-11',
        note: null,
        user: { id: 'someone', name: 'Someone', avatarUrl: null },
        createdAt: '2026-10-11T10:00:00Z',
      },
    ],
  };
});

describe('TaskTimeField', () => {
  it('shows what is logged against the estimate, and that it is over', () => {
    renderField();
    expect(screen.getByText('2h 30m logged')).toHaveClass('text-destructive');
    expect(screen.getByRole('button', { name: '2h estimated' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2h 30m of 2h estimated' })).toBeInTheDocument();
  });

  it('logs time the way it is written, and removes only one’s own entries', async () => {
    const user = setupUser();
    renderField();

    await user.click(screen.getByRole('button', { name: 'Log time' }));
    await user.type(screen.getByLabelText('Time spent'), '1h 15m');
    expect(screen.getByText('1h 15m')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Note'), 'Report');
    await user.click(screen.getAllByRole('button', { name: 'Log time' }).at(-1) as HTMLElement);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ minutes: 75, note: 'Report' }),
      expect.anything(),
    );

    await user.click(screen.getByRole('button', { name: 'Show 2 entries' }));
    expect(
      screen.getByRole('button', { name: 'Remove 1h 30m logged on 2026-10-12' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove 1h logged on 2026-10-11' }),
    ).not.toBeInTheDocument();
  });

  it('runs a timer that logs at least a minute when stopped', async () => {
    const user = setupUser();
    renderField();

    await user.click(screen.getByRole('button', { name: 'Start timer' }));
    expect(window.localStorage.getItem('coretask.timer.t-1')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Stop/ }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ minutes: 1 }));
    expect(window.localStorage.getItem('coretask.timer.t-1')).toBeNull();
  });

  it('sets the estimate from what is typed, and clears it when emptied', async () => {
    const user = setupUser();
    const { onEstimate } = renderField({ estimatedMinutes: null });

    await user.click(screen.getByRole('button', { name: 'no estimate' }));
    await user.type(screen.getByLabelText('Estimate'), '3h{Enter}');
    expect(onEstimate).toHaveBeenLastCalledWith(180);
  });
});
