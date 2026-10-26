import { ClientEvent, ServerEvent, SOCKET_NAMESPACE } from '@coretask/contracts';
import { io, type Socket } from 'socket.io-client';

import { env } from '@/app/config/env';

let socket: Socket | null = null;

/** A teardown queued by `disconnectSocketSoon`, cancelled by a reconnect. */
let pendingTeardown: ReturnType<typeof setTimeout> | null = null;

/**
 * Connects (or reuses) the realtime socket.
 *
 * The access token is passed in the handshake rather than a query string, so it
 * never lands in a proxy access log. Reconnection re-reads the token via
 * `auth` being a callback, which matters because the token rotates every
 * 15 minutes while a socket may live far longer.
 */
export function connectSocket(getToken: () => string | null): Socket {
  if (pendingTeardown) {
    clearTimeout(pendingTeardown);
    pendingTeardown = null;
  }

  if (socket?.connected) return socket;

  socket ??= io(`${env.wsUrl}${SOCKET_NAMESPACE}`, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    auth: (cb: (data: Record<string, unknown>) => void) => cb({ token: getToken() }),
  });

  if (!socket.connected) socket.connect();

  return socket;
}

export function disconnectSocket(): void {
  if (pendingTeardown) {
    clearTimeout(pendingTeardown);
    pendingTeardown = null;
  }
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

/**
 * Disconnects on the next tick, unless something connects again first.
 *
 * For unmount cleanup. React's StrictMode unmounts and remounts every component
 * once in development, and an immediate disconnect there closed the socket
 * mid-handshake — the browser logged "WebSocket is closed before the connection
 * is established" — then opened a second one. Deferred, the remount's
 * `connectSocket` cancels the teardown and the first handshake carries on. A
 * real unmount still disconnects, one tick later.
 */
export function disconnectSocketSoon(): void {
  if (pendingTeardown) clearTimeout(pendingTeardown);
  pendingTeardown = setTimeout(disconnectSocket, 0);
}

export function getSocket(): Socket | null {
  return socket;
}

/** Asks the server to add this socket to a workspace room. Membership is re-checked server-side. */
export function joinWorkspaceRoom(workspaceId: string): void {
  socket?.emit(ClientEvent.WORKSPACE_JOIN, { workspaceId });
}

export function leaveWorkspaceRoom(workspaceId: string): void {
  socket?.emit(ClientEvent.WORKSPACE_LEAVE, { workspaceId });
}

/**
 * Joins the room for one project, so a tab watching it is not woken by churn in
 * every other project in the workspace. Membership is re-checked server-side.
 */
export function joinProjectRoom(projectId: string): void {
  socket?.emit(ClientEvent.PROJECT_JOIN, { projectId });
}

export function leaveProjectRoom(projectId: string): void {
  socket?.emit(ClientEvent.PROJECT_LEAVE, { projectId });
}

export { ClientEvent, ServerEvent };
