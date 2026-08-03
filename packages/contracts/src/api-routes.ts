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
