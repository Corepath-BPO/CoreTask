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
  apiKeys: {
    all: (workspaceId: string) => ['api-keys', workspaceId] as const,
    list: (workspaceId: string) => [...queryKeys.apiKeys.all(workspaceId), 'list'] as const,
  },
  /** A person's own: the apps they registered, and the apps they connected. */
  oauthApps: ['oauth-apps'] as const,
  connectedApps: ['connected-apps'] as const,
  slack: {
    all: (workspaceId: string) => ['slack', workspaceId] as const,
    status: (workspaceId: string) => [...queryKeys.slack.all(workspaceId), 'status'] as const,
    channels: (workspaceId: string) => [...queryKeys.slack.all(workspaceId), 'channels'] as const,
  },
  webhooks: {
    all: (workspaceId: string) => ['webhooks', workspaceId] as const,
    list: (workspaceId: string) => [...queryKeys.webhooks.all(workspaceId), 'list'] as const,
    deliveries: (workspaceId: string, endpointId: string) =>
      [...queryKeys.webhooks.all(workspaceId), 'deliveries', endpointId] as const,
    delivery: (workspaceId: string, deliveryId: string) =>
      [...queryKeys.webhooks.all(workspaceId), 'delivery', deliveryId] as const,
  },
  teams: {
    all: (workspaceId: string) => ['teams', workspaceId] as const,
    list: (workspaceId: string) => [...queryKeys.teams.all(workspaceId), 'list'] as const,
    detail: (workspaceId: string, teamId: string) =>
      [...queryKeys.teams.all(workspaceId), 'detail', teamId] as const,
    messages: (workspaceId: string, teamId: string) =>
      [...queryKeys.teams.all(workspaceId), 'messages', teamId] as const,
  },
  projects: {
    /** Scoped by workspace so switching tenants cannot serve a stale list. */
    all: (workspaceId: string) => ['projects', workspaceId] as const,
    list: (workspaceId: string, filters: Record<string, unknown>) =>
      [...queryKeys.projects.all(workspaceId), 'list', filters] as const,
    detail: (workspaceId: string, projectId: string) =>
      [...queryKeys.projects.all(workspaceId), 'detail', projectId] as const,
    /** The reader's own stars; under the prefix so archiving a project drops it here too. */
    starred: (workspaceId: string) => [...queryKeys.projects.all(workspaceId), 'starred'] as const,
    /** Under the project prefix on purpose: one invalidation reaches the roster too. */
    members: (workspaceId: string, projectId: string) =>
      [...queryKeys.projects.all(workspaceId), 'members', projectId] as const,
    invitations: (workspaceId: string, projectId: string) =>
      [...queryKeys.projects.all(workspaceId), 'invitations', projectId] as const,
    note: (workspaceId: string, projectId: string) =>
      [...queryKeys.projects.all(workspaceId), 'note', projectId] as const,
    resources: (workspaceId: string, projectId: string) =>
      [...queryKeys.projects.all(workspaceId), 'resources', projectId] as const,
  },
  tasks: {
    all: (workspaceId: string) => ['tasks', workspaceId] as const,
    list: (workspaceId: string, filters: Record<string, unknown>) =>
      [...queryKeys.tasks.all(workspaceId), 'list', filters] as const,
    board: (workspaceId: string, projectId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'board', projectId] as const,
    detail: (workspaceId: string, taskId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'detail', taskId] as const,
    likes: (workspaceId: string, taskId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'likes', taskId] as const,
    /** Under `tasks` so any task change — completing the far end — refreshes it. */
    dependencies: (workspaceId: string, taskId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'dependencies', taskId] as const,
    /** Logged time; under `tasks` so an estimate change refreshes its total line. */
    time: (workspaceId: string, taskId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'time', taskId] as const,
    /** Under `tasks` so an automation that adds one refreshes the open panel. */
    checklists: (workspaceId: string, taskId: string) =>
      [...queryKeys.tasks.all(workspaceId), 'checklists', taskId] as const,
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
  followers: {
    all: (workspaceId: string) => ['followers', workspaceId] as const,
    /** `parentKind` keeps a task and a ticket with the same id from colliding. */
    forParent: (workspaceId: string, parentKind: string, parentId: string) =>
      [...queryKeys.followers.all(workspaceId), parentKind, parentId] as const,
  },
  activity: {
    all: (workspaceId: string) => ['activity', workspaceId] as const,
    /** One item's own stories; separate from the workspace feed so the panel does not refetch the dashboard. */
    item: (workspaceId: string, parentKind: string, parentId: string) =>
      [...queryKeys.activity.all(workspaceId), 'item', parentKind, parentId] as const,
  },
  notifications: {
    all: (workspaceId: string) => ['notifications', workspaceId] as const,
  },
  taskTemplates: {
    list: (workspaceId: string, projectId: string) =>
      ['task-templates', workspaceId, projectId] as const,
  },
  projectTemplates: {
    all: (workspaceId: string) => ['project-templates', workspaceId] as const,
  },
  reports: {
    dashboards: (workspaceId: string) => ['report-dashboards', workspaceId] as const,
    /** Under its own prefix: a task change anywhere can stale every chart. */
    result: (workspaceId: string, query: object) => ['report-result', workspaceId, query] as const,
  },
  /** The caller's own Home layout and notepad, per workspace. */
  home: (workspaceId: string) => ['home', workspaceId] as const,
  bundles: {
    all: (workspaceId: string) => ['bundles', workspaceId] as const,
  },
  statusTemplates: {
    list: (workspaceId: string, projectId: string) =>
      ['status-templates', workspaceId, projectId] as const,
  },
  tags: {
    all: (workspaceId: string) => ['tags', workspaceId] as const,
  },
  definitions: {
    all: (workspaceId: string) => ['definitions', workspaceId] as const,
    statuses: (workspaceId: string, projectId: string) =>
      ['definitions', workspaceId, 'statuses', projectId] as const,
    priorities: (workspaceId: string) => ['definitions', workspaceId, 'priorities'] as const,
  },
  projectApps: {
    list: (workspaceId: string, projectId: string) =>
      ['project-apps', workspaceId, projectId] as const,
  },
  projectEmail: {
    settings: (workspaceId: string, projectId: string) =>
      ['project-email', workspaceId, projectId] as const,
  },
  /** The caller's calendar link: `mine` for My Tasks, or a project's id. */
  calendarFeed: (workspaceId: string, projectId: string | null) =>
    ['calendar-feed', workspaceId, projectId ?? 'mine'] as const,
  forms: {
    list: (workspaceId: string, projectId: string) => ['forms', workspaceId, projectId] as const,
    /** The public side, by link — no workspace in the key, there is none to the submitter. */
    public: (token: string) => ['public-form', token] as const,
  },
  portfolios: {
    all: (workspaceId: string) => ['portfolios', workspaceId] as const,
    messages: (workspaceId: string, portfolioId: string) =>
      ['portfolios', workspaceId, portfolioId, 'messages'] as const,
    statusUpdates: (workspaceId: string, portfolioId: string) =>
      ['portfolios', workspaceId, portfolioId, 'status-updates'] as const,
  },
  projectUpdates: {
    all: (workspaceId: string) => ['project-updates', workspaceId] as const,
    latestStatus: (workspaceId: string) =>
      [...queryKeys.projectUpdates.all(workspaceId), 'latest-status'] as const,
    statusUpdates: (workspaceId: string, projectId: string) =>
      [...queryKeys.projectUpdates.all(workspaceId), projectId, 'status'] as const,
    messages: (workspaceId: string, projectId: string) =>
      [...queryKeys.projectUpdates.all(workspaceId), projectId, 'messages'] as const,
    files: (workspaceId: string, projectId: string) =>
      [...queryKeys.projectUpdates.all(workspaceId), projectId, 'files'] as const,
    statusDraft: (workspaceId: string, projectId: string) =>
      [...queryKeys.projectUpdates.all(workspaceId), projectId, 'status-draft'] as const,
  },
  search: {
    /** Term and kinds are part of the key — each is a different answer. */
    results: (workspaceId: string, term: string, kinds: readonly string[]) =>
      ['search', workspaceId, term, kinds.join(',')] as const,
    /** An advanced search: the filters and the day they were read against. */
    tasks: (workspaceId: string, filters: object, today: string) =>
      ['search', workspaceId, 'tasks', filters, today] as const,
    saved: (workspaceId: string) => ['saved-searches', workspaceId] as const,
  },
} as const;
