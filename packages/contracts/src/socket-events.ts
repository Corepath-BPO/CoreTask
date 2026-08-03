/**
 * Socket.IO event names and room-naming helpers.
 *
 * Both sides import these so a rename is a compile error rather than a silent
 * dead listener.
 */

/** Namespace the realtime gateway is mounted on. */
export const SOCKET_NAMESPACE = '/realtime';

/** Client -> server. */
export const ClientEvent = {
  WORKSPACE_JOIN: 'workspace:join',
  WORKSPACE_LEAVE: 'workspace:leave',
  PROJECT_JOIN: 'project:join',
  PROJECT_LEAVE: 'project:leave',
  PING: 'client:ping',
} as const;
export type ClientEvent = (typeof ClientEvent)[keyof typeof ClientEvent];

/** Server -> client. */
export const ServerEvent = {
  CONNECTED: 'server:connected',
  ERROR: 'server:error',
  PONG: 'server:pong',

  PROJECT_CREATED: 'project:created',
  PROJECT_UPDATED: 'project:updated',
  PROJECT_ARCHIVED: 'project:archived',
  PROJECT_RESTORED: 'project:restored',

  SECTION_CREATED: 'section:created',
  SECTION_UPDATED: 'section:updated',
  SECTION_DELETED: 'section:deleted',
  SECTION_MOVED: 'section:moved',

  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_MOVED: 'task:moved',
  TASK_ARCHIVED: 'task:archived',
  TASK_DELETED: 'task:deleted',

  TICKET_CREATED: 'ticket:created',
  TICKET_UPDATED: 'ticket:updated',

  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',

  NOTIFICATION_CREATED: 'notification:created',

  PRESENCE_UPDATED: 'presence:updated',
} as const;
export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent];

/** Room a socket joins to receive every event scoped to one workspace. */
export const workspaceRoom = (workspaceId: string): string => `workspace:${workspaceId}`;

/** Room scoped to a single project inside a workspace. */
export const projectRoom = (projectId: string): string => `project:${projectId}`;

/** Private room used to deliver notifications to one user across their devices. */
export const userRoom = (userId: string): string => `user:${userId}`;
