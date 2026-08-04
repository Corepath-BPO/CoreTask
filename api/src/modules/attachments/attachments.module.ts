import { Module } from '@nestjs/common';

import { StorageModule } from '../../integrations/storage/storage.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { TasksModule } from '../tasks/tasks.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  // Tasks and tickets are imported for their parent lookups, which is what keeps
  // attachment routes tenant-scoped without restating the rule.
  imports: [
    WorkspaceMembersModule,
    StorageModule,
    ActivityLogsModule,
    TasksModule,
    TicketsModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
