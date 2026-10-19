import type { Task } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyTasksSections } from './my-tasks-sections';

const place = vi.fn();

let rules = { dueToday: false, dueThisWeek: false };

vi.mock('../hooks/use-my-task-placements', () => ({
  useMyTaskPlacements: () => ({ data: [{ taskId: 't-2', bucket: 'TODAY' }] }),
  usePlaceMyTask: () => ({ mutate: place, isPending: false }),
  useMyTasksRules: () => ({ data: rules }),
}));
vi.mock('../hooks/use-tasks', () => ({
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: { items: [{ id: 'p-1', name: 'Maintenance', color: '#f00' }] } }),
}));

const task = (id: string, title: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title,
    status: 'TODO',
    projectId: 'p-1',
    dueDate: null,
    completedAt: null,
    tags: [],
    ...over,
  }) as Task;

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T00:00:00.000Z`;

const renderSections = (layout: 'list' | 'board', extra: Task[] = []) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MyTasksSections
        workspaceId="ws-1"
        tasks={[
          task('t-1', 'Leak under the sink', {
            tags: [{ id: 'g-1', name: 'Urgent', color: 'red' }],
          }),
          task('t-2', 'Replace the bulb'),
          ...extra,
        ]}
        canEdit
        onOpen={vi.fn()}
        layout={layout}
      />
    </QueryClientProvider>,
  );

beforeEach(() => {
  place.mockReset();
  rules = { dueToday: false, dueThisWeek: false };
});

describe('MyTasksSections', () => {
  it('draws the same sections as Board columns, with cards in them', async () => {
    const user = userEvent.setup();
    renderSections('board');

    const board = screen.getByLabelText('My tasks board');
    const columns = within(board).getAllByRole('region');
    expect(columns.map((column) => column.getAttribute('aria-label'))).toEqual([
      'Recently assigned',
      'Do today',
      'Do next week',
      'Do later',
    ]);
    expect(within(columns[0] as HTMLElement).getByText('Leak under the sink')).toBeInTheDocument();
    expect(within(columns[0] as HTMLElement).getByText('Urgent')).toBeInTheDocument();
    expect(within(columns[1] as HTMLElement).getByText('Replace the bulb')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Move "Leak under the sink" to another section' }),
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Do later' }));
    expect(place).toHaveBeenCalledWith({ taskId: 't-1', bucket: 'LATER' });
  });

  it('stacks them as sections in the list layout', () => {
    renderSections('list');
    expect(screen.queryByLabelText('My tasks board')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Do today' })).toHaveTextContent('Replace the bulb');
  });

  it('leaves a task due today where it is while the Do today rule is off', () => {
    const due = task('t-3', 'Pay the water bill', { dueDate: todayIso });

    renderSections('list', [due]);
    expect(screen.getByRole('region', { name: 'Recently assigned' })).toHaveTextContent(
      'Pay the water bill',
    );
  });

  it('moves a task due today into Do today when that rule is on', () => {
    rules = { dueToday: true, dueThisWeek: false };
    const due = task('t-3', 'Pay the water bill', { dueDate: todayIso });

    renderSections('list', [due]);
    expect(screen.getByRole('region', { name: 'Do today' })).toHaveTextContent(
      'Pay the water bill',
    );
  });
});
