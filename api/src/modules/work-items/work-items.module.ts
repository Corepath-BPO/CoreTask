import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { WebsocketModule } from '../../websocket/websocket.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AutomationEventsModule } from '../automations/automation-events.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { FollowersModule } from '../followers/followers.module';
import { ProjectViewsModule } from '../project-views/project-views.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectWorkItemService } from './project-work-item.service';
import { TaskWorkItemRepository } from './repositories/task-work-item.repository';
import { TicketWorkItemRepository } from './repositories/ticket-work-item.repository';
import { WorkItemOrderRepository } from './repositories/work-item-order.repository';
import { WorkItemsController } from './work-items.controller';

/**
 * The shared layer both project views read and write through.
 *
 * It imports the *leaf* automation and websocket modules rather than the rule
 * engine, so a domain change can be announced without dragging in the thing
 * that reacts to it — the same one-way dependency the custom fields module uses.
 *
 * It deliberately does not import TasksModule or TicketsModule. Those own their
 * own endpoints and keep working untouched; going through them would mean this
 * layer inherits their workspace-scoped shape, which is what it exists to
 * replace for project work.
 */
@Module({
  imports: [
    WorkspaceMembersModule,
    ProjectAccessModule,
    ProjectsModule,
    ActivityLogsModule,
    AutomationEventsModule,
    WebsocketModule,
    NotificationsIntegrationModule,
    FollowersModule,
    // Formula values on every row, and the one validated path a bulk edit
    // writes field values through.
    CustomFieldsModule,
    // The project's field map, which a filter or sort naming a custom field
    // is compiled against. Nothing in the views module imports this one back.
    ProjectViewsModule,
  ],
  controllers: [WorkItemsController],
  providers: [
    ProjectWorkItemService,
    TaskWorkItemRepository,
    TicketWorkItemRepository,
    WorkItemOrderRepository,
  ],
  exports: [ProjectWorkItemService],
})
export class WorkItemsModule {}
