import { ServerEvent } from '@coretask/contracts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient, queryKeys } from '@/lib/api/query-client';

const on = vi.fn();
const off = vi.fn();

vi.mock('@/lib/socket/socket-client', () => ({
  getSocket: () => ({ on, off }),
  joinProjectRoom: vi.fn(),
  leaveProjectRoom: vi.fn(),
}));

import { useProjectRealtime } from './use-project-realtime';

const WORKSPACE = 'ws-1';
const PROJECT = 'proj-1';
const TASK = 'task-1';

const handlerFor = (event: string) =>
  on.mock.calls.find(([name]) => name === event)?.[1] as (payload: unknown) => void;

const rows = queryKeys.workItems.list(WORKSPACE, PROJECT, {});
const panel = queryKeys.tasks.detail(WORKSPACE, TASK);
const thread = queryKeys.comments.thread(WORKSPACE, 'task', TASK);

const isStale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

const change = {
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  workItemId: TASK,
  workItemType: 'TASK',
  actorId: 'someone-else',
  occurredAt: '2026-10-16T12:00:00.000Z',
};

describe('useProjectRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    for (const key of [rows, panel, thread]) queryClient.setQueryData(key, {});
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('refreshes the rows and the open task for somebody else’s change', () => {
    renderHook(() => useProjectRealtime(WORKSPACE, PROJECT));

    handlerFor(ServerEvent.WORK_ITEM_UPDATED)(change);

    expect(isStale(rows)).toBe(true);
    expect(isStale(panel)).toBe(true);
  });

  /*
   * A rule's change also arrives at `useAutomationRealtime`, which every screen
   * mounts and which refreshes the task, its comments and its history. Doing
   * that here too would fetch the open panel twice.
   */
  it('refreshes only the rows for a rule’s change, leaving the task to the workspace hook', () => {
    renderHook(() => useProjectRealtime(WORKSPACE, PROJECT));

    handlerFor(ServerEvent.WORK_ITEM_UPDATED)({ ...change, actorId: null, source: 'automation' });

    expect(isStale(rows)).toBe(true);
    expect(isStale(panel)).toBe(false);
    expect(isStale(thread)).toBe(false);
  });

  it('ignores another project’s change', () => {
    renderHook(() => useProjectRealtime(WORKSPACE, PROJECT));

    handlerFor(ServerEvent.WORK_ITEM_UPDATED)({ ...change, projectId: 'proj-2' });

    expect(isStale(rows)).toBe(false);
    expect(isStale(panel)).toBe(false);
  });
});
