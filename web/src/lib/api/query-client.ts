import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-error';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Auth and permission failures will not fix themselves; validation and
        // not-found even less so. Only retry transient infrastructure errors.
        if (error instanceof ApiError) {
          if (error.status === 0) return failureCount < 2;
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Query-key factory. Centralised so invalidation cannot miss a cache entry. */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  workspaces: {
    all: ['workspaces'] as const,
    list: () => [...queryKeys.workspaces.all, 'list'] as const,
    detail: (workspaceId: string) => [...queryKeys.workspaces.all, 'detail', workspaceId] as const,
    members: (workspaceId: string) =>
      [...queryKeys.workspaces.all, 'members', workspaceId] as const,
  },
} as const;
