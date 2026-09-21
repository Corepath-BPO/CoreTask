import { ServerEvent } from '@coretask/contracts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient, queryKeys } from '@/lib/api/query-client';

const on = vi.fn();
const off = vi.fn();
const leaveProjectRoom = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/socket/socket-client', () => ({
  getSocket: () => ({ on, off }),
  leaveProjectRoom: (projectId: string) => leaveProjectRoom(projectId),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // Somewhere other than the project being revoked, so the handler does its
  // cache work without also trying to navigate.
  useRouter: () => ({ state: { location: { pathname: '/tasks' } } }),
}));

vi.mock('sonner', () => ({ toast: vi.fn() }));

import { useProjectAccessRealtime } from './use-project-access-realtime';

const WORKSPACE = 'ws-1';
const PROJECT = 'proj-1';

/** The handler the hook registered for one server event. */
const handlerFor = (event: string) =>
  on.mock.calls.find(([name]) => name === event)?.[1] as (payload: unknown) => void;

/** Inferred rather than annotated: `vi.spyOn`'s generics do not survive a widening. */
const spyOnInvalidate = () =>
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

describe('useProjectAccessRealtime', () => {
  let invalidate: ReturnType<typeof spyOnInvalidate>;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidate = spyOnInvalidate();
    vi.spyOn(queryClient, 'removeQueries').mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The query keys the handler asked to refetch, as plain arrays. */
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));

  it('refetches every workspace-wide list the server filters by project', () => {
    renderHook(() => useProjectAccessRealtime(WORKSPACE));

    handlerFor(ServerEvent.PROJECT_ACCESS_REVOKED)({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
    });

    const keys = invalidatedKeys();

    // Tasks alone was not enough: the ticket queue and the activity feed are
    // compiled with the same visibility filter, and a cached one went on
    // showing the revoked project's rows.
    expect(keys).toContain(JSON.stringify(queryKeys.projects.all(WORKSPACE)));
    expect(keys).toContain(JSON.stringify(queryKeys.tasks.all(WORKSPACE)));
    expect(keys).toContain(JSON.stringify(queryKeys.tickets.all(WORKSPACE)));
    expect(keys).toContain(JSON.stringify(queryKeys.activity.all(WORKSPACE)));
  });

  it('leaves the project room', () => {
    renderHook(() => useProjectAccessRealtime(WORKSPACE));

    handlerFor(ServerEvent.PROJECT_ACCESS_REVOKED)({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
    });

    expect(leaveProjectRoom).toHaveBeenCalledWith(PROJECT);
  });

  it('ignores an event for another workspace', () => {
    renderHook(() => useProjectAccessRealtime(WORKSPACE));

    handlerFor(ServerEvent.PROJECT_ACCESS_REVOKED)({
      workspaceId: 'ws-2',
      projectId: PROJECT,
    });

    expect(invalidate).not.toHaveBeenCalled();
    expect(leaveProjectRoom).not.toHaveBeenCalled();
  });
});
