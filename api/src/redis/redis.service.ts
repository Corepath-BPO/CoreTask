import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: AppConfigService) {
    this.client = new Redis(this.connectionOptions());

    this.client.on('error', (error: Error) => {
      // ioredis retries on its own; log once per error rather than crashing.
      this.logger.warn({ err: error }, 'Redis connection error');
    });
    this.client.on('connect', () => this.logger.log('Connected to Redis'));
  }

  /**
   * BullMQ needs its own connection with `maxRetriesPerRequest: null`, so it
   * builds a client from these options rather than sharing `client`.
   */
  connectionOptions(): RedisOptions {
    const { host, port, password, db } = this.config.redis;

    return {
      host,
      port,
      db,
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch (error) {
      this.logger.warn({ err: error }, 'Redis health check failed');
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
