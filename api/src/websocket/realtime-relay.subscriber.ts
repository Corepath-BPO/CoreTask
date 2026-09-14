import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import { RedisService } from '../redis/redis.service';

import { REALTIME_RELAY_CHANNEL, type RealtimeRelayMessage } from './realtime-relay.publisher';
import { RealtimeGateway } from './realtime.gateway';

/**
 * The API-side half of the worker's broadcasts.
 *
 * Listens on the relay channel and re-emits each message through the gateway,
 * which is the one place holding live sockets. Registered in the websocket
 * module, so it exists exactly where the gateway does and never in the worker
 * — the worker publishing to itself would be a loop with extra steps.
 */
@Injectable()
export class RealtimeRelaySubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeRelaySubscriber.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    /*
     * A dedicated connection, not the shared client: a Redis connection in
     * subscribe mode can run nothing else, so subscribing on the client every
     * other service issues commands through would break all of them at once.
     */
    this.subscriber = new Redis(this.redis.connectionOptions());
    this.subscriber.on('error', (error: Error) => {
      this.logger.warn({ err: error }, 'Realtime relay subscriber connection error');
    });

    await this.subscriber.subscribe(REALTIME_RELAY_CHANNEL);
    this.subscriber.on('message', (_channel: string, raw: string) => this.deliver(raw));
  }

  private deliver(raw: string): void {
    let message: RealtimeRelayMessage;

    try {
      message = JSON.parse(raw) as RealtimeRelayMessage;
    } catch {
      // A malformed message is dropped rather than crashing the relay: the
      // channel is shared infrastructure and one bad publisher must not
      // silence every good one.
      this.logger.warn('Dropped a realtime relay message that was not JSON');
      return;
    }

    if (typeof message?.projectId !== 'string' || typeof message.event !== 'string') return;

    this.gateway.emitToProject(message.projectId, message.event, message.payload ?? {});
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    await this.subscriber.quit().catch(() => this.subscriber?.disconnect());
  }
}
