import type { TaskChecklist } from '@coretask/types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskChecklists } from './task-checklists';

const mutation = () => ({ mutate: vi.fn(), isPending: false });
let actions: Record<string, ReturnType<typeof mutation>>;
let checklists: TaskChecklist[];

vi.mock('../hooks/use-task-checklists', () => ({
  useTaskChecklists: () => ({ data: checklists }),
  useChecklistActions: () => actions,
}));

const inspection = (): TaskChecklist => ({
  id: 'c-1',
  taskId: 't-1',
  name: 'Move-in inspection',
  position: 1000,
  createdBy: null,
  createdAt: '2026-10-16T10:00:00Z',
  items: [
    {
      id: 'i-1',
      title: 'Keys handed over',
      position: 1000,
      completed: true,
      completedAt: '2026-10-16T11:00:00Z',
      completedBy: { id: 'u-1', name: 'Dana' },
    },
    {
      id: 'i-2',
      title: 'Meter readings taken',
      position: 2000,
      completed: false,
      completedAt: null,
      completedBy: null,
    },
  ],
});

beforeEach(() => {
  actions = {
    create: mutation(),
    update: mutation(),
    remove: mutation(),
    addItem: mutation(),
    updateItem: mutation(),
    removeItem: mutation(),
  };
  checklists = [inspection()];
});

describe('TaskChecklists', () => {
  it('shows each checklist with its progress and its ticks', () => {
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit />);

    expect(screen.getByRole('heading', { name: 'Move-in inspection' })).toBeInTheDocument();
    expect(screen.getByLabelText('1 of 2 done')).toHaveTextContent('1/2');
    expect(screen.getByRole('checkbox', { name: 'Keys handed over' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Meter readings taken' })).not.toBeChecked();
    expect(screen.getByText('Keys handed over')).toHaveAttribute('title', 'Ticked by Dana');
  });

  it('ticks an item by its checkbox or its text', async () => {
    const user = userEvent.setup();
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit />);

    await user.click(screen.getByText('Meter readings taken'));
    expect(actions['updateItem']?.mutate).toHaveBeenCalledWith({
      checklistId: 'c-1',
      itemId: 'i-2',
      completed: true,
    });

    await user.click(screen.getByRole('checkbox', { name: 'Keys handed over' }));
    expect(actions['updateItem']?.mutate).toHaveBeenLastCalledWith({
      checklistId: 'c-1',
      itemId: 'i-1',
      completed: false,
    });
  });

  it('adds an item on Enter and stays open for the next', async () => {
    const user = userEvent.setup();
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit />);

    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    const box = screen.getByRole('textbox', { name: 'New item for "Move-in inspection"' });
    await user.type(box, '  Smoke alarms tested {Enter}');

    expect(actions['addItem']?.mutate).toHaveBeenCalledWith(
      { checklistId: 'c-1', title: 'Smoke alarms tested' },
      expect.anything(),
    );
    expect(box).toBeInTheDocument();
  });

  it('answers Escape in its own box, so the task panel stays open', async () => {
    const user = userEvent.setup();
    const reached = vi.fn();
    const listener = (event: KeyboardEvent) => reached(event.defaultPrevented);
    window.addEventListener('keydown', listener);
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit />);

    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    await user.keyboard('{Escape}');

    expect(reached).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    window.removeEventListener('keydown', listener);
  });

  it('names a new checklist, and ignores a blank name', async () => {
    const user = userEvent.setup();
    checklists = [];
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit />);

    await user.click(screen.getByRole('button', { name: 'Add checklist' }));
    const box = screen.getByRole('textbox', { name: 'New checklist name' });
    await user.type(box, '   {Enter}');
    expect(actions['create']?.mutate).not.toHaveBeenCalled();

    await user.type(box, 'Launch list{Enter}');
    expect(actions['create']?.mutate).toHaveBeenCalledWith(
      { name: 'Launch list' },
      expect.anything(),
    );
  });

  it('asks before deleting a checklist', async () => {
    const user = userEvent.setup();
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit />);

    await user.click(
      screen.getByRole('button', { name: 'Actions for the checklist "Move-in inspection"' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete checklist' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/and its 2 items are removed/)).toBeInTheDocument();
    expect(actions['remove']?.mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(actions['remove']?.mutate).toHaveBeenCalledWith('c-1');
  });

  it('is read-only for someone who cannot edit, and absent when there is nothing to read', () => {
    const { unmount } = render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit={false} />);
    expect(screen.getByRole('checkbox', { name: 'Keys handed over' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add an item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for the checklist/ })).toBeNull();
    unmount();

    checklists = [];
    render(<TaskChecklists workspaceId="ws-1" taskId="t-1" canEdit={false} />);
    expect(screen.queryByRole('region', { name: 'Checklists' })).not.toBeInTheDocument();
  });
});
