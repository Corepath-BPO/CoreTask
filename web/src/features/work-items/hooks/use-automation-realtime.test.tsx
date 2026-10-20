import { ServerEvent } from '@coretask/contracts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient, queryKeys } from '@/lib/api/query-client';

const on = vi.fn();
const off = vi.fn();

vi.mock('@/lib/socket/socket-client', () => ({
  getSocket: () => ({ on, off }),
}));

import { useAutomationRealtime } from './use-automation-realtime';

const WORKSPACE = 'ws-1';
const PROJECT = 'proj-1';
const TASK = 'task-1';

/** The handler the hook registered for one server event. */
const handlerFor = (event: string) =>
  on.mock.calls.find(([name]) => name === event)?.[1] as (payload: unknown) => void;

/** What a task panel opened from My Tasks holds: no project page, no project room. */
const panelKeys = [
  queryKeys.tasks.detail(WORKSPACE, TASK),
  queryKeys.tasks.checklists(WORKSPACE, TASK),
  queryKeys.tasks.list(WORKSPACE, { assigneeId: 'me' }),
  queryKeys.comments.thread(WORKSPACE, 'task', TASK),
  queryKeys.activity.item(WORKSPACE, 'task', TASK),
];

const isStale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

const ruleChange = {
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  workItemId: TASK,
  workItemType: 'TASK',
  occurredAt: '2026-10-16T12:00:00.000Z',
  source: 'automation',
};

describe('useAutomationRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    for (const key of panelKeys) queryClient.setQueryData(key, {});
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('marks the open task’s fields and checklists stale when a rule changed it', () => {
    renderHook(() => useAutomationRealtime(WORKSPACE));

    handlerFor(ServerEvent.WORK_ITEM_UPDATED)(ruleChange);

    for (const key of panelKeys) expect(isStale(key), JSON.stringify(key)).toBe(true);
  });

  it('leaves a person’s own edit to the listeners that already handle it', () => {
    renderHook(() => useAutomationRealtime(WORKSPACE));

    handlerFor(ServerEvent.WORK_ITEM_UPDATED)({ ...ruleChange, source: undefined });

    for (const key of panelKeys) expect(isStale(key)).toBe(false);
  });

  it('ignores a rule in another workspace', () => {
    renderHook(() => useAutomationRealtime(WORKSPACE));

    handlerFor(ServerEvent.WORK_ITEM_UPDATED)({ ...ruleChange, workspaceId: 'ws-2' });

    for (const key of panelKeys) expect(isStale(key)).toBe(false);
  });

  it('stops listening when the workspace goes away', () => {
    const { unmount } = renderHook(() => useAutomationRealtime(WORKSPACE));
    const handler = handlerFor(ServerEvent.WORK_ITEM_UPDATED);

    unmount();

    expect(off).toHaveBeenCalledWith(ServerEvent.WORK_ITEM_UPDATED, handler);
  });
});
