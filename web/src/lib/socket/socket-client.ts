import { ClientEvent, ServerEvent, SOCKET_NAMESPACE } from '@coretask/contracts';
import { io, type Socket } from 'socket.io-client';

import { env } from '@/app/config/env';

let socket: Socket | null = null;

/**
 * Connects (or reuses) the realtime socket.
 *
 * The access token is passed in the handshake rather than a query string, so it
 * never lands in a proxy access log. Reconnection re-reads the token via
 * `auth` being a callback, which matters because the token rotates every
 * 15 minutes while a socket may live far longer.
 */
export function connectSocket(getToken: () => string | null): Socket {
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
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
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

export { ClientEvent, ServerEvent };
