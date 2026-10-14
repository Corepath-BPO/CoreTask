import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { GoalUpdatesController } from './goal-updates.controller';
import { GoalUpdatesService } from './goal-updates.service';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule, NotificationsIntegrationModule],
  controllers: [GoalsController, GoalUpdatesController],
  providers: [GoalsService, GoalUpdatesService],
})
export class GoalsModule {}
