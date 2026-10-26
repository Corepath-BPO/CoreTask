import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardData } from './use-dashboard';

/**
 * These guard one specific failure: an unstable value inside a query key.
 *
 * The dashboard's "upcoming deadlines" query is bounded by a date computed at
 * render time. When that carried millisecond precision, every render produced a
 * different key, so TanStack Query started a new query, which re-rendered, which
 * produced another key — a refetch loop that only stopped when the API's rate
 * limiter started returning 429s. Nothing about it looks wrong on screen.
 */

const listTasks = vi.fn();

vi.mock('@/features/tasks/api/tasks.api', () => ({
  tasksApi: { list: (...args: unknown[]) => listTasks(...args) },
}));

vi.mock('@/features/projects/api/projects.api', () => ({
  projectsApi: { list: () => Promise.resolve({ items: [], meta: {} }) },
}));

vi.mock('@/features/tickets/api/tickets.api', () => ({
  ticketsApi: { list: () => Promise.resolve({ items: [], meta: {} }) },
}));

vi.mock('@/features/activity/api/activity.api', () => ({
  activityApi: { list: () => Promise.resolve([]) },
  notificationsApi: { list: () => Promise.resolve({ items: [], unreadCount: 0 }) },
}));

const EMPTY_PAGE = {
  items: [],
  meta: { page: 1, limit: 5, total: 0, totalPages: 0, summary: {} },
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const WORKSPACE_ID = '019fc880-0000-7000-8000-000000000000';

describe('useDashboardData query keys', () => {
  beforeEach(() => {
    listTasks.mockReset();
    listTasks.mockResolvedValue(EMPTY_PAGE);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not refetch forever when re-rendered', async () => {
    const { rerender } = renderHook(() => useDashboardData(WORKSPACE_ID), { wrapper });

    await waitFor(() => expect(listTasks).toHaveBeenCalled());
    const afterFirstRender = listTasks.mock.calls.length;

    // Several renders that change nothing must not start new queries.
    rerender();
    rerender();
    rerender();
    await Promise.resolve();

    expect(listTasks.mock.calls.length).toBe(afterFirstRender);
  });

  it('uses a due-date bound that is identical across renders', async () => {
    const { rerender } = renderHook(() => useDashboardData(WORKSPACE_ID), { wrapper });
    await waitFor(() => expect(listTasks).toHaveBeenCalled());

    // Time passes between renders, as it does in a real session.
    vi.advanceTimersByTime(5_000);
    rerender();

    const bounds = listTasks.mock.calls
      .map(([, params]) => (params as { dueBefore?: string }).dueBefore)
      .filter((value): value is string => typeof value === 'string');

    expect(bounds.length).toBeGreaterThan(0);
    expect(new Set(bounds).size).toBe(1);
  });

  it('bounds the window at the end of the day, so day fourteen is included', async () => {
    renderHook(() => useDashboardData(WORKSPACE_ID), { wrapper });
    await waitFor(() => expect(listTasks).toHaveBeenCalled());

    const bound = listTasks.mock.calls
      .map(([, params]) => (params as { dueBefore?: string }).dueBefore)
      .find((value): value is string => typeof value === 'string');

    const asDate = new Date(bound as string);
    expect(asDate.getHours()).toBe(23);
    expect(asDate.getMinutes()).toBe(59);
  });
});
