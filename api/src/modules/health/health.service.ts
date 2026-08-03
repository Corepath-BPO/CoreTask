import type { HealthStatus } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

/** Read from package.json at build time; falls back for local runs. */
const APP_VERSION = process.env.npm_package_version ?? '0.1.0';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthStatus> {
    // Probed in parallel so a slow dependency does not serialise the check.
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      database: database ? 'connected' : 'disconnected',
      redis: redis ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
      version: APP_VERSION,
    };
  }
}
