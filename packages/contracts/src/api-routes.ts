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
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    logoutAll: '/auth/logout-all',
    changePassword: '/auth/change-password',
    verifyEmail: '/auth/verify-email',
    resendVerification: '/auth/resend-verification',
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
    messages: (workspaceId: string, teamId: string) =>
      `/workspaces/${workspaceId}/teams/${teamId}/messages`,
    message: (workspaceId: string, teamId: string, messageId: string) =>
      `/workspaces/${workspaceId}/teams/${teamId}/messages/${messageId}`,
    replies: (workspaceId: string, teamId: string, messageId: string) =>
      `/workspaces/${workspaceId}/teams/${teamId}/messages/${messageId}/replies`,
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
  /** Intake forms: managed per project, filled in publicly by link. */
  forms: {
    list: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/forms`,
    detail: (workspaceId: string, projectId: string, formId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/forms/${formId}`,
    public: (token: string) => `/public/forms/${token}`,
    submit: (token: string) => `/public/forms/${token}/submissions`,
  },
  /** A project's task statuses, and the workspace's priorities. */
  definitions: {
    statuses: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/statuses`,
    status: (workspaceId: string, projectId: string, statusId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/statuses/${statusId}`,
    reorderStatuses: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/statuses/reorder`,
    priorities: (workspaceId: string) => `/workspaces/${workspaceId}/priorities`,
    priority: (workspaceId: string, priorityId: string) =>
      `/workspaces/${workspaceId}/priorities/${priorityId}`,
    reorderPriorities: (workspaceId: string) => `/workspaces/${workspaceId}/priorities/reorder`,
  },
  /** Workspace tags, and the tags on a task. */
  tags: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/tags`,
    detail: (workspaceId: string, tagId: string) => `/workspaces/${workspaceId}/tags/${tagId}`,
    onTask: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/tags`,
    onTaskDetail: (workspaceId: string, taskId: string, tagId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/tags/${tagId}`,
  },
  /** Advanced search over tasks, and the searches people keep. */
  savedSearches: {
    tasks: (workspaceId: string) => `/workspaces/${workspaceId}/search/tasks`,
    list: (workspaceId: string) => `/workspaces/${workspaceId}/saved-searches`,
    detail: (workspaceId: string, searchId: string) =>
      `/workspaces/${workspaceId}/saved-searches/${searchId}`,
  },
  /** Chat apps a project posts its updates to (Slack, Teams…). */
  projectApps: {
    list: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/apps`,
    detail: (workspaceId: string, projectId: string, appId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/apps/${appId}`,
    test: (workspaceId: string, projectId: string, appId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/apps/${appId}/test`,
  },
  /** Every dependency between two tasks of a project, for its Timeline. */
  projectDependencies: (workspaceId: string, projectId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}/dependencies`,
  /** A project's key resources, on its Overview. */
  projectResources: (workspaceId: string, projectId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}/resources`,
  projectResource: (workspaceId: string, projectId: string, resourceId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceId}`,
  /** The caller's own profile. */
  profile: '/users/me',
  /** A person's calendar links: their My Tasks, or one project. */
  calendarFeeds: {
    mine: (workspaceId: string) => `/workspaces/${workspaceId}/calendar-feeds`,
    reset: (workspaceId: string) => `/workspaces/${workspaceId}/calendar-feeds/reset`,
    /** What calendar apps fetch — no account, the token is the key. */
    feed: (token: string) => `/calendar/${token}.ics`,
  },
  /** A project's tasks as a CSV file. */
  projectExportCsv: (workspaceId: string, projectId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}/export/csv`,
  /** A project's Note tab: one document per project. */
  projectNote: (workspaceId: string, projectId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}/note`,
  /** A project's email address, and the webhook mail providers deliver to. */
  projectEmail: {
    settings: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/email`,
    resetAddress: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/email/address`,
    inbound: '/inbound/email',
  },
  /** Task templates: ready-made tasks a project's Add menu can create. */
  taskTemplates: {
    list: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/task-templates`,
    detail: (workspaceId: string, projectId: string, templateId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/task-templates/${templateId}`,
    use: (workspaceId: string, projectId: string, templateId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/task-templates/${templateId}/use`,
  },
  /** Report dashboards, and the numbers behind one chart. */
  reports: {
    dashboards: (workspaceId: string) => `/workspaces/${workspaceId}/report-dashboards`,
    dashboard: (workspaceId: string, dashboardId: string) =>
      `/workspaces/${workspaceId}/report-dashboards/${dashboardId}`,
    tasks: (workspaceId: string) => `/workspaces/${workspaceId}/reports/tasks`,
  },
  /** The caller's own Home: which widgets, in what order, and their notepad. */
  home: (workspaceId: string) => `/workspaces/${workspaceId}/home`,
  /** Project templates, and a project's own copy of itself. */
  projectTemplates: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/project-templates`,
    detail: (workspaceId: string, templateId: string) =>
      `/workspaces/${workspaceId}/project-templates/${templateId}`,
    use: (workspaceId: string, templateId: string) =>
      `/workspaces/${workspaceId}/project-templates/${templateId}/use`,
    duplicate: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/duplicate`,
  },
  /** Bundles: a project's workflow, packaged for other projects. */
  bundles: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/bundles`,
    detail: (workspaceId: string, bundleId: string) =>
      `/workspaces/${workspaceId}/bundles/${bundleId}`,
    refresh: (workspaceId: string, bundleId: string) =>
      `/workspaces/${workspaceId}/bundles/${bundleId}/refresh`,
    project: (workspaceId: string, bundleId: string, projectId: string) =>
      `/workspaces/${workspaceId}/bundles/${bundleId}/projects/${projectId}`,
  },
  /** Status templates: a status update's starting point, per project. */
  statusTemplates: {
    list: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/status-templates`,
    detail: (workspaceId: string, projectId: string, templateId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/status-templates/${templateId}`,
  },
  /** Portfolios: named sets of projects, workspace-wide, starred per person. */
  portfolios: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/portfolios`,
    detail: (workspaceId: string, portfolioId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}`,
    projects: (workspaceId: string, portfolioId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/projects`,
    project: (workspaceId: string, portfolioId: string, projectId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/projects/${projectId}`,
    star: (workspaceId: string, portfolioId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/star`,
    capacity: (workspaceId: string, portfolioId: string, userId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/capacity/${userId}`,
    messages: (workspaceId: string, portfolioId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/messages`,
    message: (workspaceId: string, portfolioId: string, messageId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/messages/${messageId}`,
    replies: (workspaceId: string, portfolioId: string, messageId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/messages/${messageId}/replies`,
    statusUpdates: (workspaceId: string, portfolioId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/status-updates`,
    statusUpdate: (workspaceId: string, portfolioId: string, updateId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/status-updates/${updateId}`,
    requestStatus: (workspaceId: string, portfolioId: string) =>
      `/workspaces/${workspaceId}/portfolios/${portfolioId}/status-updates/request`,
  },
  /** Status updates, messages and files — what a project says about itself. */
  projectUpdates: {
    latestStatus: (workspaceId: string) => `/workspaces/${workspaceId}/status-updates/latest`,
    statusUpdates: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/status-updates`,
    statusUpdate: (workspaceId: string, projectId: string, updateId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/status-updates/${updateId}`,
    /** Ask the project's owner for a status update. */
    requestStatus: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/status-updates/request`,
    /** The update a rule's AI step drafted, waiting to be reviewed and posted. */
    statusDraft: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/status-draft`,
    messages: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/messages`,
    message: (workspaceId: string, projectId: string, messageId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/messages/${messageId}`,
    replies: (workspaceId: string, projectId: string, messageId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/messages/${messageId}/replies`,
    files: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/files`,
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
    /** Invitations by e-mail that join the workspace and land in this project. */
    invitations: (workspaceId: string, projectId: string) =>
      `/workspaces/${workspaceId}/projects/${projectId}/invitations`,
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
    likes: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/likes`,
    dependencies: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/dependencies`,
    dependency: (workspaceId: string, taskId: string, dependencyId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/dependencies/${dependencyId}`,
    /** "Mark as duplicate": POST names the original, DELETE undoes it. */
    duplicateOf: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/duplicate-of`,
    /** Time logged against a task. */
    timeEntries: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/time-entries`,
    timeEntry: (workspaceId: string, taskId: string, entryId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/time-entries/${entryId}`,
    /** A task's checklists, each with its items. */
    checklists: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/checklists`,
    checklist: (workspaceId: string, taskId: string, checklistId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/checklists/${checklistId}`,
    checklistItems: (workspaceId: string, taskId: string, checklistId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/checklists/${checklistId}/items`,
    checklistItem: (workspaceId: string, taskId: string, checklistId: string, itemId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`,
    /** Multi-homing: the other projects a task is in. */
    projects: (workspaceId: string, taskId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/projects`,
    project: (workspaceId: string, taskId: string, projectId: string) =>
      `/workspaces/${workspaceId}/tasks/${taskId}/projects/${projectId}`,
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
  oauth: {
    consent: '/oauth/consent',
    authorize: '/oauth/authorize',
    token: '/oauth/token',
    revoke: '/oauth/revoke',
    apps: '/users/me/oauth-apps',
    app: (appId: string) => `/users/me/oauth-apps/${appId}`,
    rotateSecret: (appId: string) => `/users/me/oauth-apps/${appId}/rotate-secret`,
    connectedApps: '/users/me/connected-apps',
    connectedApp: (appId: string) => `/users/me/connected-apps/${appId}`,
  },
  webhookSubscriptions: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/webhook-subscriptions`,
    one: (workspaceId: string, subscriptionId: string) =>
      `/workspaces/${workspaceId}/webhook-subscriptions/${subscriptionId}`,
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
  search: (workspaceId: string) => `/workspaces/${workspaceId}/search`,
  starredProjects: (workspaceId: string) => `/workspaces/${workspaceId}/starred-projects`,
  goals: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/goals`,
    detail: (workspaceId: string, goalId: string) => `/workspaces/${workspaceId}/goals/${goalId}`,
    project: (workspaceId: string, goalId: string, projectId: string) =>
      `/workspaces/${workspaceId}/goals/${goalId}/projects/${projectId}`,
    updates: (workspaceId: string, goalId: string) =>
      `/workspaces/${workspaceId}/goals/${goalId}/updates`,
    update: (workspaceId: string, goalId: string, updateId: string) =>
      `/workspaces/${workspaceId}/goals/${goalId}/updates/${updateId}`,
  },
  myTaskPlacements: (workspaceId: string) => `/workspaces/${workspaceId}/my-tasks/placements`,
  myTaskPlacement: (workspaceId: string, taskId: string) =>
    `/workspaces/${workspaceId}/my-tasks/placements/${taskId}`,
  /** The caller's My Tasks auto-sort rules, in this workspace. */
  myTasksRules: (workspaceId: string) => `/workspaces/${workspaceId}/my-tasks/rules`,
  projectStar: (workspaceId: string, projectId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}/star`,
  activity: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/activity`,
    /** One item's stories, newest first, by `entity`, `entityId` and a `before` cursor. */
    forItem: (workspaceId: string) => `/workspaces/${workspaceId}/activity/item`,
    /** One project's history, newest first, by `projectId` and a `before` cursor. */
    forProject: (workspaceId: string) => `/workspaces/${workspaceId}/activity/project`,
  },
  /** Which notifications the caller also gets by email, in this workspace. */
  notificationPreferences: (workspaceId: string) =>
    `/workspaces/${workspaceId}/notification-preferences`,
  notifications: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/notifications`,
    markRead: (workspaceId: string) => `/workspaces/${workspaceId}/notifications/read`,
    markUnread: (workspaceId: string, notificationId: string) =>
      `/workspaces/${workspaceId}/notifications/${notificationId}/unread`,
    archive: (workspaceId: string) => `/workspaces/${workspaceId}/notifications/archive`,
    unarchive: (workspaceId: string, notificationId: string) =>
      `/workspaces/${workspaceId}/notifications/${notificationId}/unarchive`,
    bookmark: (workspaceId: string, notificationId: string) =>
      `/workspaces/${workspaceId}/notifications/${notificationId}/bookmark`,
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
