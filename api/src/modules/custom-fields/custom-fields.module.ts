import { Module } from '@nestjs/common';

import { WebsocketModule } from '../../websocket/websocket.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AutomationEventsModule } from '../automations/automation-events.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { CustomFieldsController, TaskCustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';

@Module({
  /*
   * `AutomationEventsModule` and `WebsocketModule`, not the full automations
   * module: those two are leaves that exist precisely so a domain module can
   * announce a change without dragging the rule engine in behind it.
   */
  imports: [
    WorkspaceMembersModule,
    ProjectsModule,
    ActivityLogsModule,
    AutomationEventsModule,
    WebsocketModule,
  ],
  controllers: [CustomFieldsController, TaskCustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
