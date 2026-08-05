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
    invitations: (workspaceId: string) =>
      [...queryKeys.workspaces.all, 'invitations', workspaceId] as const,
  },
  invitationPreview: (token: string) => ['invitation-preview', token] as const,
  teams: {
    all: (workspaceId: string) => ['teams', workspaceId] as const,
    list: (workspaceId: string) => [...queryKeys.teams.all(workspaceId), 'list'] as const,
    detail: (workspaceId: string, teamId: string) =>
      [...queryKeys.teams.all(workspaceId), 'detail', teamId] as const,
  },
  projects: {
    /** Scoped by workspace so switching tenants cannot serve a stale list. */
    all: (workspaceId: string) => ['projects', workspaceId] as const,
    list: (workspaceId: string, filters: Record<string, unknown>) =>
      [...queryKeys.projects.all(workspaceId), 'list', filters] as const,
    detail: (workspaceId: string, projectId: string) =>
      [...queryKeys.projects.all(workspaceId), 'detail', projectId] as const,
  },
  tasks: {
    all: (workspaceId: string) => ['tasks', workspaceId] as const,
    list: (workspaceId: string, filters: Record<string, unknown>) =>
      [...queryKeys.tasks.all(workspaceId), 'list', filters] as const,
    board: (workspaceId: string, projectId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'board', projectId] as const,
    detail: (workspaceId: string, taskId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'detail', taskId] as const,
  },
  tickets: {
    all: (workspaceId: string) => ['tickets', workspaceId] as const,
    list: (workspaceId: string, filters: Record<string, unknown>) =>
      [...queryKeys.tickets.all(workspaceId), 'list', filters] as const,
    /** Keyed by whatever the caller holds — a UUID or a key like `CORE-1001`. */
    detail: (workspaceId: string, idOrKey: string) =>
      [...queryKeys.tickets.all(workspaceId), 'detail', idOrKey] as const,
  },
  /*
   * One family for the project's work items, read by List and Board alike.
   *
   * Both views previously kept their own cache of the same rows under unrelated
   * keys — `tasks.board` and `projectViews.tasks` — so invalidating one left the
   * other showing yesterday's answer. A single prefix means one invalidation
   * reaches every drawing of the data.
   */
  workItems: {
    all: (workspaceId: string, projectId: string) =>
      ['work-items', workspaceId, projectId] as const,
    /** Prefix only; the query shape is appended by the caller. */
    list: (workspaceId: string, projectId: string, query: Record<string, unknown>) =>
      [...queryKeys.workItems.all(workspaceId, projectId), 'list', query] as const,
    detail: (workspaceId: string, projectId: string, workItemId: string) =>
      [...queryKeys.workItems.all(workspaceId, projectId), 'detail', workItemId] as const,
  },
  projectViews: {
    all: (workspaceId: string, projectId: string) =>
      ['project-views', workspaceId, projectId] as const,
    metadata: (workspaceId: string, projectId: string) =>
      ['project-views', workspaceId, projectId, 'metadata'] as const,
    /** The search term is part of the key — each one is a different answer. */
    catalog: (workspaceId: string, projectId: string, search: string) =>
      ['project-views', workspaceId, projectId, 'catalog', search] as const,
    /** Prefix only — the filter and page are appended by the caller. */
    tasks: (workspaceId: string, projectId: string) =>
      ['project-views', workspaceId, projectId, 'tasks'] as const,
    /** One entry per expanded parent, so collapsing does not discard the fetch. */
    subtasks: (workspaceId: string, projectId: string, taskId: string) =>
      ['project-views', workspaceId, projectId, 'subtasks', taskId] as const,
  },
  attachments: {
    all: (workspaceId: string) => ['attachments', workspaceId] as const,
    /** `parentKind` keeps a task and a ticket with the same id from colliding. */
    forParent: (workspaceId: string, parentKind: string, parentId: string) =>
      [...queryKeys.attachments.all(workspaceId), parentKind, parentId] as const,
  },
  comments: {
    all: (workspaceId: string) => ['comments', workspaceId] as const,
    /** `parentKind` keeps a task and a ticket with the same id from colliding. */
    thread: (workspaceId: string, parentKind: string, parentId: string) =>
      [...queryKeys.comments.all(workspaceId), parentKind, parentId] as const,
  },
  activity: {
    all: (workspaceId: string) => ['activity', workspaceId] as const,
  },
  notifications: {
    all: (workspaceId: string) => ['notifications', workspaceId] as const,
  },
} as const;
