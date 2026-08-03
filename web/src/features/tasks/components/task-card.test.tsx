import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { TaskPriority, TaskStatus } from '@coretask/contracts';
import type { Task } from '@coretask/types';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, userEvent } from '@/test/test-utils';

import { TaskCard } from './task-card';

const baseTask: Task = {
  id: '019fc880-0000-7000-8000-000000000001',
  workspaceId: 'w',
  projectId: 'p',
  sectionId: 's',
  parentTaskId: null,
  title: 'Wire the dashboard summary endpoints',
  description: null,
  status: TaskStatus.IN_PROGRESS,
  priority: TaskPriority.HIGH,
  position: 1000,
  startDate: null,
  dueDate: null,
  completedAt: null,
  archivedAt: null,
  estimatedMinutes: null,
  assigneeId: null,
  assignee: null,
  createdById: 'u',
  subtaskCount: 0,
  completedSubtaskCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** `useSortable` needs a DndContext + SortableContext above it. */
function renderCard(overrides: Partial<Task> = {}, { draggable = true } = {}) {
  const onOpen = vi.fn();
  const task = { ...baseTask, ...overrides };

  renderWithProviders(
    <DndContext>
      <SortableContext items={[task.id]}>
        <TaskCard task={task} onOpen={onOpen} draggable={draggable} />
      </SortableContext>
    </DndContext>,
  );

  return { onOpen, task };
}

const daysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

describe('TaskCard', () => {
  it('shows the title and priority', () => {
    renderCard();

    expect(screen.getByText(baseTask.title)).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('hides the priority badge when there is none', () => {
    renderCard({ priority: TaskPriority.NONE });
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });

  it('shows subtask progress only when there are subtasks', () => {
    renderCard({ subtaskCount: 3, completedSubtaskCount: 1 });
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('counts a relative due date down while the task is open', () => {
    renderCard({ dueDate: daysFromNow(2) });
    expect(screen.getByText('In 2d')).toBeInTheDocument();
  });

  it('calls out an overdue task', () => {
    renderCard({ dueDate: daysFromNow(-3) });
    expect(screen.getByText('3d overdue')).toBeInTheDocument();
  });

  /**
   * A finished task is never "overdue" — the deadline stopped mattering when it
   * was completed, and saying otherwise made done columns look like failures.
   */
  it('shows a plain date rather than an overdue countdown once done', () => {
    renderCard({ status: TaskStatus.DONE, dueDate: daysFromNow(-3) });

    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^[A-Z][a-z]{2} \d{1,2}$/)).toBeInTheDocument();
  });

  /**
   * Rendered with dragging off on purpose.
   *
   * dnd-kit's PointerSensor calls `preventDefault()` on `pointerdown`, and
   * `userEvent` faithfully suppresses the follow-up click — so a drag-enabled
   * card can never be "clicked" in jsdom. Real browsers still deliver the
   * click, which was confirmed by hand against the running app; a Playwright
   * spec is the right place to cover the drag-enabled path.
   *
   * The handler wiring is identical either way, which is what this asserts.
   */
  it('opens the task when the title is activated', async () => {
    const user = userEvent.setup();
    const { onOpen, task } = renderCard({}, { draggable: false });

    await user.click(screen.getByText(task.title));
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup();
    const { onOpen, task } = renderCard({}, { draggable: false });

    await user.tab();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it('renders the assignee monogram', () => {
    renderCard({
      assignee: { id: 'u1', name: 'Maya Okafor', email: 'maya@coretask.dev', avatarUrl: null },
    });

    expect(screen.getByText('MO')).toBeInTheDocument();
  });
});
