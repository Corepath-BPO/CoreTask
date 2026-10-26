import type { Tag, TagRef } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { TaskTagsField } from './task-tags-field';

const add = vi.fn();
const remove = vi.fn();
let workspaceTags: Tag[];

vi.mock('../hooks/use-tags', () => ({
  useTags: () => ({ data: workspaceTags }),
  useAddTaskTag: () => ({ mutate: add, isPending: false }),
  useRemoveTaskTag: () => ({ mutate: remove, isPending: false }),
}));

const tag = (id: string, name: string, taskCount = 0): Tag => ({
  id,
  name,
  color: 'blue',
  taskCount,
  createdBy: null,
  createdAt: '2026-10-14T00:00:00Z',
});

const renderField = (tags: TagRef[], canEdit = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskTagsField workspaceId="ws-1" taskId="t-1" tags={tags} canEdit={canEdit} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  add.mockReset();
  remove.mockReset();
  workspaceTags = [tag('g-1', 'Urgent', 3), tag('g-2', 'Plumbing', 1)];
});

describe('TaskTagsField', () => {
  it('shows the task’s tags and takes one off', async () => {
    const user = setupUser();
    renderField([{ id: 'g-1', name: 'Urgent', color: 'red' }]);

    expect(screen.getByText('Urgent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove the tag Urgent' }));
    expect(remove).toHaveBeenCalledWith('g-1');
  });

  it('adds a tag the workspace has, leaving out the ones already on', async () => {
    const user = setupUser();
    renderField([{ id: 'g-1', name: 'Urgent', color: 'red' }]);

    await user.click(screen.getByRole('button', { name: 'Add a tag' }));
    expect(screen.queryByRole('option', { name: /Urgent/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Plumbing/ }));
    expect(add).toHaveBeenCalledWith({ tagId: 'g-2' });
  });

  it('makes a tag from a new name, but not from one that exists', async () => {
    const user = setupUser();
    renderField([]);

    await user.click(screen.getByRole('button', { name: 'Add a tag' }));
    await user.type(screen.getByPlaceholderText('Find or make a tag…'), 'plumbing');
    expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Find or make a tag…'));
    await user.type(screen.getByPlaceholderText('Find or make a tag…'), 'Roof  leak');
    await user.click(screen.getByRole('option', { name: 'Create “Roof leak”' }));
    expect(add).toHaveBeenCalledWith({ name: 'Roof leak' });
  });

  it('only reads for someone who cannot edit', () => {
    renderField([{ id: 'g-1', name: 'Urgent', color: 'red' }], false);
    expect(screen.queryByRole('button', { name: 'Add a tag' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the tag/ })).not.toBeInTheDocument();
  });
});
