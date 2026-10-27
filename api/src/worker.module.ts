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
import { ImportProcessor } from './jobs/import/import.processor';
import { WebhookProcessor } from './jobs/webhook/webhook.processor';
import { AsanaImporterModule } from './modules/asana-import/asana-importer.module';
import { AttachmentSweeperModule } from './modules/attachments/attachment-sweeper.module';
import { AutomationClockModule } from './modules/automations/automation-clock.module';
import { AutomationEventsModule } from './modules/automations/automation-events.module';
import { AutomationRunnerModule } from './modules/automations/automation-runner.module';
import { WebhookDeliveryModule } from './modules/webhooks/webhook-delivery.module';
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
    // The publisher as well as the runner: a rule's change is announced back
    // onto the queue so the next rule in a chain gets its turn.
    AutomationEventsModule,
    // The clock behind "scheduled time", "due date is approaching" and the rest.
    AutomationClockModule,
    WebhookDeliveryModule,
    // Imports from other tools; Asana only, so far.
    AsanaImporterModule,
  ],
  providers: [
    EmailProcessor,
    MaintenanceProcessor,
    AutomationProcessor,
    WebhookProcessor,
    ImportProcessor,
  ],
})
export class WorkerModule {}
