/** Global prefix every REST route is mounted behind. */
export const API_PREFIX = '/api/v1';

/** Path Swagger UI is served from (not versioned — it documents all versions). */
export const API_DOCS_PATH = '/api/docs';

/**
 * Endpoint paths *relative to* {@link API_PREFIX}. The web client's HTTP layer
 * already has the prefix in its base URL, so it consumes these as-is.
 */
export const ApiRoutes = {
  health: '/health',
  auth: {
    register: '/auth/register',
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
  },
  workspaces: {
    list: '/workspaces',
    create: '/workspaces',
    detail: (workspaceId: string) => `/workspaces/${workspaceId}`,
    update: (workspaceId: string) => `/workspaces/${workspaceId}`,
    members: (workspaceId: string) => `/workspaces/${workspaceId}/members`,
  },
  /**
   * Nested under the workspace on purpose: the `:workspaceId` segment is what
   * `WorkspaceMemberGuard` reads, so tenant isolation comes from the URL shape
   * rather than from each handler remembering to check it.
   */
  projects: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/projects`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/projects`,
    detail: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}`,
    update: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}`,
    archive: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}`,
    restore: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/restore`,
  },
  /**
   * Workspace-scoped rather than nested under a project: a task may have no
   * project at all, and "my tasks" spans every project in the workspace.
   * Project and section are filters on the list instead of path segments.
   */
  tasks: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/tasks`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/tasks`,
    detail: (workspaceId: string, taskId: string) => `/workspaces/${workspaceId}/tasks/${taskId}`,
    update: (workspaceId: string, taskId: string) => `/workspaces/${workspaceId}/tasks/${taskId}`,
    move: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/move`,
    archive: (workspaceId: string, taskId: string) => `/workspaces/${workspaceId}/tasks/${taskId}`,
    restore: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/restore`,
  },
  /**
   * Like tasks, workspace-scoped: a ticket may have no project, and the queue
   * is read across the whole workspace.
   */
  tickets: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/tickets`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/tickets`,
    /** Accepts a UUID or a human key such as `CORE-1001`. */
    detail: (workspaceId: string, idOrKey: string) =>
      `/workspaces/${workspaceId}/tickets/${idOrKey}`,
    update: (workspaceId: string, idOrKey: string) =>
      `/workspaces/${workspaceId}/tickets/${idOrKey}`,
  },
  /**
   * Reading and posting are nested under the thing being discussed, because
   * that is what a thread is. Editing and deleting are not: a comment id is
   * unique on its own, and making the client remember which parent a comment
   * came from just to edit it buys nothing.
   */
  comments: {
    forTask: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/comments`,
    /** Accepts a UUID or a human key such as `CORE-1001`. */
    forTicket: (workspaceId: string, idOrKey: string) =>
      `/workspaces/${workspaceId}/tickets/${idOrKey}/comments`,
    update: (workspaceId: string, commentId: string) =>
      `/workspaces/${workspaceId}/comments/${commentId}`,
    remove: (workspaceId: string, commentId: string) =>
      `/workspaces/${workspaceId}/comments/${commentId}`,
  },
  activity: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/activity`,
  },
  notifications: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/notifications`,
    markRead: (workspaceId: string) => `/workspaces/${workspaceId}/notifications/read`,
  },
  sections: {
    list: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/sections`,
    create: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/sections`,
    update: (workspaceId: string, projectId: string, sectionId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/sections/${sectionId}`,
    move: (workspaceId: string, projectId: string, sectionId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/sections/${sectionId}/move`,
    remove: (workspaceId: string, projectId: string, sectionId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/sections/${sectionId}`,
  },
} as const;
