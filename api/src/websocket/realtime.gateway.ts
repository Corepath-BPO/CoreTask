import {
  ClientEvent,
  ServerEvent,
  SOCKET_NAMESPACE,
  projectRoom,
  userRoom,
  workspaceRoom,
} from '@coretask/contracts';
import type { AccessTokenPayload } from '@coretask/types';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

interface SocketData {
  userId: string;
  sessionId: string;
}

/** Socket with the identity we attach on connect; `data` starts empty. */
type AuthedSocket = Omit<Socket, 'data'> & { data: Partial<SocketData> };

/**
 * Realtime foundation.
 *
 * Authenticates on connect using the same access token as REST, then keeps each
 * socket in rooms it is authorised for. Domain modules broadcast through
 * `emitToWorkspace` / `emitToUser` rather than reaching for the server directly.
 */
@WebSocketGateway({
  namespace: SOCKET_NAMESPACE,
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = extractToken(client);

    if (!token) {
      client.emit(ServerEvent.ERROR, { code: 'UNAUTHORIZED' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.jwt.accessSecret,
      });

      client.data.userId = payload.sub;
      client.data.sessionId = payload.sid;

      // Private room for notifications addressed to this person on any device.
      await client.join(userRoom(payload.sub));
      client.emit(ServerEvent.CONNECTED, { userId: payload.sub });
    } catch {
      client.emit(ServerEvent.ERROR, { code: 'ACCESS_TOKEN_INVALID' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.data.userId) {
      this.logger.debug({ userId: client.data.userId }, 'Socket disconnected');
    }
  }

  /**
   * Room membership is authorised server-side. A client asking to join a
   * workspace it does not belong to is refused, so a room name is never enough
   * to read another tenant's events.
   */
  @SubscribeMessage(ClientEvent.WORKSPACE_JOIN)
  async onWorkspaceJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { workspaceId?: string },
  ): Promise<{ joined: boolean }> {
    const { userId } = client.data;
    const workspaceId = body?.workspaceId;

    if (!userId || !workspaceId) return { joined: false };

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });

    if (!membership) {
      client.emit(ServerEvent.ERROR, { code: 'WORKSPACE_ACCESS_DENIED', workspaceId });
      return { joined: false };
    }

    await client.join(workspaceRoom(workspaceId));
    return { joined: true };
  }

  @SubscribeMessage(ClientEvent.WORKSPACE_LEAVE)
  async onWorkspaceLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { workspaceId?: string },
  ): Promise<{ left: boolean }> {
    if (!body?.workspaceId) return { left: false };
    await client.leave(workspaceRoom(body.workspaceId));
    return { left: true };
  }

  /**
   * A project room, so a tab watching one project is not woken by every other.
   *
   * Authorised through the project's workspace rather than the project id
   * alone: a project id is guessable and a room name is not a permission. The
   * lookup does both jobs at once — it fails if the project does not exist, and
   * it fails if the caller is not a member of the workspace holding it.
   */
  @SubscribeMessage(ClientEvent.PROJECT_JOIN)
  async onProjectJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { projectId?: string },
  ): Promise<{ joined: boolean }> {
    const { userId } = client.data;
    const projectId = body?.projectId;

    if (!userId || !projectId) return { joined: false };

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspace: { members: { some: { userId } } } },
      select: { id: true },
    });

    if (!project) {
      client.emit(ServerEvent.ERROR, { code: 'PROJECT_ACCESS_DENIED', projectId });
      return { joined: false };
    }

    await client.join(projectRoom(projectId));
    return { joined: true };
  }

  @SubscribeMessage(ClientEvent.PROJECT_LEAVE)
  async onProjectLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { projectId?: string },
  ): Promise<{ left: boolean }> {
    if (!body?.projectId) return { left: false };
    await client.leave(projectRoom(body.projectId));
    return { left: true };
  }

  @SubscribeMessage(ClientEvent.PING)
  onPing(): { event: string; at: string } {
    return { event: ServerEvent.PONG, at: new Date().toISOString() };
  }

  emitToWorkspace(workspaceId: string, event: string, payload: unknown): void {
    this.server?.to(workspaceRoom(workspaceId)).emit(event, payload);
  }

  emitToProject(projectId: string, event: string, payload: unknown): void {
    this.server?.to(projectRoom(projectId)).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  /**
   * Takes somebody out of a workspace's room, on every device at once.
   *
   * Membership is checked when a socket joins and never again, so removing
   * someone left their open tabs in the room — still receiving every task,
   * section, ticket and comment payload for a workspace they had been thrown
   * out of. Their REST calls started failing immediately, so the screen looked
   * broken while the data kept arriving.
   *
   * Addressed through the user's own room rather than by tracking socket ids,
   * because one person may have several tabs and two laptops, and the room is
   * the only place that already knows about all of them.
   */
  async evictFromWorkspace(workspaceId: string, userId: string): Promise<void> {
    await this.server?.in(userRoom(userId)).socketsLeave(workspaceRoom(workspaceId));

    this.logger.log({ workspaceId, userId }, 'Evicted a user from a workspace room');
  }
}

/** Accepts the token from the handshake auth payload or an Authorization header. */
function extractToken(client: AuthedSocket): string | null {
  const fromAuth = client.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return fromAuth.replace(/^Bearer\s+/i, '');
  }

  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7);
  }

  return null;
}
