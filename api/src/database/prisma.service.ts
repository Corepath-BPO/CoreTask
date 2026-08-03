import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfigService) {
    super({
      datasources: { db: { url: config.database.url } },
      log: config.isProduction
        ? [{ emit: 'stdout', level: 'error' }]
        : [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap liveness probe used by the health endpoint. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, 'PostgreSQL health check failed');
      return false;
    }
  }

  /**
   * Empties every application table. Used by the e2e suite between specs.
   *
   * Refuses to run against a production database — an accidental import in the
   * wrong process should not be able to destroy real data.
   */
  async truncateAllTables(): Promise<void> {
    if (this.config.isProduction) {
      throw new Error('truncateAllTables() is disabled when NODE_ENV=production.');
    }

    // `current_schema()` rather than a literal 'public': the e2e suite points
    // DATABASE_URL at a separate schema so it never touches development data.
    const tables = await this.$queryRaw<{ schemaname: string; tablename: string }[]>`
      SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename NOT LIKE '_prisma%'
    `;

    if (tables.length === 0) return;

    const quoted = tables
      .map(({ schemaname, tablename }) => `"${schemaname}"."${tablename}"`)
      .join(', ');
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  }
}

export { Prisma };
