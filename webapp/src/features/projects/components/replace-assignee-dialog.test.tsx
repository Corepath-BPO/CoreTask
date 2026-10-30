import type { ReplaceAssigneePayload, UserRef } from '@coretask/types';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workItemsApi } from '@/features/work-items/api/work-items.api';
import { renderWithProviders, setupUser } from '@/test/test-utils';

import { ReplaceAssigneeDialog } from './replace-assignee-dialog';

vi.mock('@/features/work-items/api/work-items.api', () => ({
  workItemsApi: { replaceAssignee: vi.fn() },
}));

const person = (id: string, name: string): UserRef => ({
  id,
  name,
  email: `${id}@x.dev`,
  avatarUrl: null,
});
const earl = person('u-earl', 'Earl');
const ana = person('u-ana', 'Ana');

const replaceAssignee = vi.mocked(workItemsApi.replaceAssignee);

/** A server holding `total` of Earl's rows, handing over a hundred a request. */
function serverWithRows(total: number) {
  let left = total;
  replaceAssignee.mockImplementation(async (_workspaceId, _projectId, payload) => {
    if (payload.dryRun) return { replaced: 0, remaining: left };
    const replaced = Math.min(left, 100);
    left -= replaced;
    return { replaced, remaining: left };
  });
}

const writes = () =>
  replaceAssignee.mock.calls
    .map(([, , payload]) => payload)
    .filter((payload: ReplaceAssigneePayload) => !payload.dryRun);

function renderDialog() {
  const onOpenChange = vi.fn();
  renderWithProviders(
    <ReplaceAssigneeDialog
      workspaceId="ws-1"
      projectId="p-1"
      people={[earl, ana]}
      assignees={[earl, ana]}
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

describe('ReplaceAssigneeDialog', () => {
  beforeEach(() => {
    replaceAssignee.mockReset();
  });

  it('counts a person’s open tasks and hands every one over, a hundred at a time', async () => {
    serverWithRows(101);
    const user = setupUser();
    const { onOpenChange } = renderDialog();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Find' }));
    await user.click(screen.getByRole('option', { name: /Earl/ }));
    expect(await screen.findByText('101 open tasks assigned to Earl.')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Replace with' }));
    // Nobody is replaced with themselves.
    expect(screen.queryByRole('option', { name: /Earl/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Ana/ }));
    expect(screen.getByText('101 open tasks assigned to Earl will go to Ana.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(writes()).toEqual([
      expect.objectContaining({ fromUserId: 'u-earl', toUserId: 'u-ana', includeCompleted: false }),
      expect.objectContaining({ fromUserId: 'u-earl', toUserId: 'u-ana', includeCompleted: false }),
    ]);
    // One correlation id across the requests, so this tab knows every row's event.
    expect(new Set(writes().map((payload) => payload.correlationId)).size).toBe(1);
  });

  it('can leave the tasks with nobody, completed ones included', async () => {
    serverWithRows(2);
    const user = setupUser();
    renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Find' }));
    await user.click(screen.getByRole('option', { name: /Earl/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Include completed tasks' }));
    await user.click(screen.getByRole('combobox', { name: 'Replace with' }));
    await user.click(screen.getByRole('option', { name: 'No assignee' }));
    expect(
      await screen.findByText('2 tasks assigned to Earl will go to nobody.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() =>
      expect(writes()).toEqual([
        expect.objectContaining({ fromUserId: 'u-earl', toUserId: null, includeCompleted: true }),
      ]),
    );
  });

  it('says so when the tasks cannot be counted, rather than counting forever', async () => {
    replaceAssignee.mockRejectedValue(new Error('offline'));
    const user = setupUser();
    renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Find' }));
    await user.click(screen.getByRole('option', { name: /Earl/ }));

    expect(
      await screen.findByText('Could not count Earl’s tasks. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
  });

  it('has nothing to replace when the person holds no tasks here', async () => {
    serverWithRows(0);
    const user = setupUser();
    renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Find' }));
    await user.click(screen.getByRole('option', { name: /Earl/ }));
    await user.click(screen.getByRole('combobox', { name: 'Replace with' }));
    await user.click(screen.getByRole('option', { name: /Ana/ }));

    expect(await screen.findByText('No open tasks here are assigned to Earl.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
  });
});
