import { Module } from '@nestjs/common';

import { SlackClientModule } from '../../integrations/slack/slack.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { SlackInteractionsService } from './slack-interactions.service';
import { SlackSignatureGuard } from './slack-signature.guard';
import { SlackAccountController, SlackController, SlackEventsController } from './slack.controller';
import { SlackService } from './slack.service';

/** The CoreTask Slack app: install, account links, and what Slack sends. */
@Module({
  imports: [
    SlackClientModule,
    ActivityLogsModule,
    ProjectAccessModule,
    TasksModule,
    WorkspaceMembersModule,
  ],
  controllers: [SlackController, SlackAccountController, SlackEventsController],
  providers: [SlackService, SlackInteractionsService, SlackSignatureGuard],
  exports: [SlackService],
})
export class SlackModule {}
