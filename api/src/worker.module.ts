import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { buildLoggerOptions } from './config/logger.config';
import { PrismaModule } from './database/prisma.module';
import { EmailModule } from './integrations/email/email.module';
import { EmailProcessor } from './jobs/email/email.processor';
import { AutomationProcessor } from './jobs/automation/automation.processor';
import { MaintenanceProcessor } from './jobs/maintenance/maintenance.processor';
import { JobsModule } from './jobs/jobs.module';
import { AttachmentSweeperModule } from './modules/attachments/attachment-sweeper.module';
import { AutomationRunnerModule } from './modules/automations/automation-runner.module';
import { RedisModule } from './redis/redis.module';

/**
 * Background worker composition.
 *
 * Shares the API's codebase but registers *processors* instead of controllers,
 * so the two scale independently: a long-running import cannot slow down request
 * handling, and the API can be replaced without draining the queue.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: buildLoggerOptions,
    }),
    PrismaModule,
    RedisModule,
    JobsModule,
    EmailModule,
    AttachmentSweeperModule,
    AutomationRunnerModule,
  ],
  providers: [EmailProcessor, MaintenanceProcessor, AutomationProcessor],
})
export class WorkerModule {}
