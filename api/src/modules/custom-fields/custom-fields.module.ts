import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { WebsocketModule } from '../../websocket/websocket.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AutomationEventsModule } from '../automations/automation-events.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import {
  CustomFieldsController,
  TaskCustomFieldsController,
  WorkspaceCustomFieldsController,
} from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';
import { FormulaValuesService } from './formula-values.service';

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
    NotificationsIntegrationModule,
  ],
  controllers: [
    CustomFieldsController,
    WorkspaceCustomFieldsController,
    TaskCustomFieldsController,
  ],
  // `FormulaValuesService` is exported for the list paths that decorate rows
  // with computed values; it depends on Prisma alone.
  providers: [CustomFieldsService, FormulaValuesService],
  exports: [CustomFieldsService, FormulaValuesService],
})
export class CustomFieldsModule {}
