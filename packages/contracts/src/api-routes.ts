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
  teams: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/teams`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/teams`,
    detail: (workspaceId: string, teamId: string) => `/workspaces/${workspaceId}/teams/${teamId}`,
    update: (workspaceId: string, teamId: string) => `/workspaces/${workspaceId}/teams/${teamId}`,
    remove: (workspaceId: string, teamId: string) => `/workspaces/${workspaceId}/teams/${teamId}`,
    addMember: (workspaceId: string, teamId: string) =>
      `/workspaces/${workspaceId}/teams/${teamId}/members`,
    removeMember: (workspaceId: string, teamId: string, userId: string) =>
      `/workspaces/${workspaceId}/teams/${teamId}/members/${userId}`,
  },
  members: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/members`,
    updateRole: (workspaceId: string, memberId: string) =>
      `/workspaces/${workspaceId}/members/${memberId}`,
    /** Also the "leave" path, when the member being removed is the caller. */
    remove: (workspaceId: string, memberId: string) =>
      `/workspaces/${workspaceId}/members/${memberId}`,
    transferOwnership: (workspaceId: string, memberId: string) =>
      `/workspaces/${workspaceId}/members/${memberId}/transfer-ownership`,
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
   * A project's members — the list a private project is private to. Removing
   * one names the user, so "leave" and "remove someone" share a route; `join`
   * and `leave` exist for the common self-service case on a public project.
   */
  projectMembers: {
    list: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/members`,
    add: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/members`,
    updateRole: (workspaceId: string, projectId: string, userId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/members/${userId}`,
    remove: (workspaceId: string, projectId: string, userId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/members/${userId}`,
    join: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/join`,
    leave: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/leave`,
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
    subtasks: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/subtasks`,
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
  attachments: {
    /** Declares a file and returns somewhere to PUT it. */
    create: (workspaceId: string) => `/workspaces/${workspaceId}/attachments`,
    /** Called once the bytes have landed; the API then verifies them. */
    confirm: (workspaceId: string, attachmentId: string) =>
      `/workspaces/${workspaceId}/attachments/${attachmentId}/confirm`,
    forTask: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/attachments`,
    /** Accepts a UUID or a human key such as `CORE-1001`. */
    forTicket: (workspaceId: string, idOrKey: string) =>
      `/workspaces/${workspaceId}/tickets/${idOrKey}/attachments`,
    download: (workspaceId: string, attachmentId: string) =>
      `/workspaces/${workspaceId}/attachments/${attachmentId}/download`,
    /** A short-lived URL that renders inline — images in a description. */
    view: (workspaceId: string, attachmentId: string) =>
      `/workspaces/${workspaceId}/attachments/${attachmentId}/view`,
    remove: (workspaceId: string, attachmentId: string) =>
      `/workspaces/${workspaceId}/attachments/${attachmentId}`,
  },

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
    /** `POST` to like, `DELETE` to take it back; both return the comment. */
    like: (workspaceId: string, commentId: string) =>
      `/workspaces/${workspaceId}/comments/${commentId}/like`,
    /** `POST` to pin, `DELETE` to unpin; one pinned comment per thread. */
    pin: (workspaceId: string, commentId: string) =>
      `/workspaces/${workspaceId}/comments/${commentId}/pin`,
  },
  /**
   * Followers hang off the item like its thread does. Removing one names the
   * user, since "leave" and "remove someone" are the same route with a
   * different caller.
   */
  followers: {
    forTask: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/followers`,
    /** Accepts a UUID or a human key such as `CORE-1001`. */
    forTicket: (workspaceId: string, idOrKey: string) =>
      `/workspaces/${workspaceId}/tickets/${idOrKey}/followers`,
    removeFromTask: (workspaceId: string, taskId: string, userId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/followers/${userId}`,
    removeFromTicket: (workspaceId: string, idOrKey: string, userId: string) =>
      `/workspaces/${workspaceId}/tickets/${idOrKey}/followers/${userId}`,
  },
  /**
   * Managing invitations is workspace-scoped, but *accepting* one cannot be:
   * the person holding the link is not a member yet, so `WorkspaceMemberGuard`
   * would turn them away from a route under `/workspaces/:workspaceId`. The
   * token identifies the workspace instead.
   */
  invitations: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/invitations`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/invitations`,
    revoke: (workspaceId: string, invitationId: string) =>
      `/workspaces/${workspaceId}/invitations/${invitationId}`,
    /** Readable without a session, so the sign-in page can name the workspace. */
    preview: (token: string) => `/invitations/${token}`,
    accept: (token: string) => `/invitations/${token}/accept`,
  },
  /**
   * A field is defined once per workspace and used by projects; the project
   * routes read and change it *as this project uses it*, the library route
   * reaches a definition no project holds any more.
   */
  customFields: {
    forProject: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/custom-fields`,
    forProjectField: (workspaceId: string, projectId: string, fieldId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/custom-fields/${fieldId}`,
    attach: (workspaceId: string, projectId: string, fieldId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/custom-fields/${fieldId}/attach`,
    options: (workspaceId: string, projectId: string, fieldId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/custom-fields/${fieldId}/options`,
    option: (workspaceId: string, projectId: string, fieldId: string, optionId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/custom-fields/${fieldId}/options/${optionId}`,
    /** `PUT` sets, `DELETE` clears. */
    taskValue: (workspaceId: string, taskId: string, fieldId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/custom-fields/${fieldId}`,
    /** The definition itself — rename, re-describe, archive or restore — needing no project. */
    libraryField: (workspaceId: string, fieldId: string) =>
      `/workspaces/${workspaceId}/custom-fields/${fieldId}`,
  },
  /**
   * Workspace API keys, nested under the workspace like invitations. `whoami`
   * is not: a tool calls it to check its credential and learn which workspace
   * its key belongs to, so it cannot be asked to know that first.
   */
  apiKeys: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/api-keys`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/api-keys`,
    update: (workspaceId: string, apiKeyId: string) =>
      `/workspaces/${workspaceId}/api-keys/${apiKeyId}`,
    revoke: (workspaceId: string, apiKeyId: string) =>
      `/workspaces/${workspaceId}/api-keys/${apiKeyId}`,
  },
  integration: {
    whoami: '/integration/whoami',
  },
  webhooks: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/webhooks`,
    create: (workspaceId: string) => `/workspaces/${workspaceId}/webhooks`,
    detail: (workspaceId: string, endpointId: string) =>
      `/workspaces/${workspaceId}/webhooks/${endpointId}`,
    update: (workspaceId: string, endpointId: string) =>
      `/workspaces/${workspaceId}/webhooks/${endpointId}`,
    remove: (workspaceId: string, endpointId: string) =>
      `/workspaces/${workspaceId}/webhooks/${endpointId}`,
    /** Returns the new signing secret once. */
    rotateSecret: (workspaceId: string, endpointId: string) =>
      `/workspaces/${workspaceId}/webhooks/${endpointId}/rotate-secret`,
    /** Queues a `ping` delivery so the receiver can be checked. */
    test: (workspaceId: string, endpointId: string) =>
      `/workspaces/${workspaceId}/webhooks/${endpointId}/test`,
  },
  /**
   * One flat, filterable list rather than a list per endpoint: a rule can send
   * to an ad-hoc URL, and those deliveries belong to no endpoint at all.
   */
  webhookDeliveries: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/webhook-deliveries`,
    detail: (workspaceId: string, deliveryId: string) =>
      `/workspaces/${workspaceId}/webhook-deliveries/${deliveryId}`,
    redeliver: (workspaceId: string, deliveryId: string) =>
      `/workspaces/${workspaceId}/webhook-deliveries/${deliveryId}/redeliver`,
  },
  activity: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/activity`,
    /** One item's stories, newest first, by `entity`, `entityId` and a `before` cursor. */
    forItem: (workspaceId: string) => `/workspaces/${workspaceId}/activity/item`,
  },
  notifications: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/notifications`,
    markRead: (workspaceId: string) => `/workspaces/${workspaceId}/notifications/read`,
    markUnread: (workspaceId: string, notificationId: string) =>
      `/workspaces/${workspaceId}/notifications/${notificationId}/unread`,
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
