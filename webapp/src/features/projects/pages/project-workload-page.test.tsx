import type { Task } from '@coretask/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectWorkloadPage } from './project-workload-page';

const mutate = vi.fn();
let canEdit = true;

const ada = { id: 'u-1', name: 'Ada Owner', email: 'a@x.org', avatarUrl: null };
const bea = { id: 'u-2', name: 'Bea Member', email: 'b@x.org', avatarUrl: null };
const task = (over: Partial<Task>): Task =>
  ({
    id: 't-1',
    title: 'Renew the lease',
    assigneeId: null,
    assignee: null,
    startDate: null,
    startAt: null,
    dueDate: null,
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    estimatedMinutes: null,
    ...over,
  }) as Task;

const tasks = [
  task({ id: 't-1', assigneeId: 'u-1', assignee: ada, dueDate: '2026-10-16T00:00:00.000Z' }),
  task({ id: 't-2', title: 'Fix the boiler', assigneeId: 'u-2', assignee: bea }),
];

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1' } }),
}));
vi.mock('@/features/portfolios/hooks/use-portfolio-tasks', () => ({
  usePortfolioTasks: () => ({ tasks, isLoading: false }),
}));
vi.mock('@/features/tasks/hooks/use-tasks', () => ({
  useUpdateTask: () => ({ mutate }),
}));
vi.mock('../hooks/use-projects', () => ({
  useProject: () => ({ data: { id: 'p-1', archivedAt: null } }),
}));
vi.mock('../lib/project-access', () => ({
  useProjectAccess: () => ({ canEdit }),
}));

beforeEach(() => {
  // Only the clock: Wednesday 14 October 2026.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 10));
  mutate.mockReset();
  canEdit = true;
});

afterEach(() => {
  vi.useRealTimers();
});

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' });

describe('ProjectWorkloadPage', () => {
  it('hands a task to another person and week by dragging it there', () => {
    render(<ProjectWorkloadPage projectId="p-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Ada Owner, This week: 1 task' }));
    const source = screen.getByRole('button', { name: /Renew the lease/ });
    expect(source).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(source, { dataTransfer: dataTransfer() });

    // Bea's row, next week: an empty cell.
    const beaRow = screen.getByRole('rowheader', { name: /Bea Member/ }).closest('tr')!;
    const nextWeek = beaRow.querySelectorAll('td')[2];
    fireEvent.dragOver(nextWeek, { dataTransfer: dataTransfer() });
    fireEvent.drop(nextWeek, { dataTransfer: dataTransfer() });

    expect(mutate).toHaveBeenCalledWith(
      { taskId: 't-1', payload: { assigneeId: 'u-2', dueDate: '2026-10-23' } },
      expect.anything(),
    );
  });

  it('lists tasks without dragging for someone who cannot edit', () => {
    canEdit = false;
    render(<ProjectWorkloadPage projectId="p-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Ada Owner, This week: 1 task' }));
    expect(screen.getByRole('button', { name: /Renew the lease/ })).toHaveAttribute(
      'draggable',
      'false',
    );
  });
});
