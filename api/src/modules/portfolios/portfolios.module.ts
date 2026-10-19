import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { PortfolioMessagesController } from './portfolio-messages.controller';
import { PortfolioMessagesService } from './portfolio-messages.service';
import { PortfolioStatusController } from './portfolio-status.controller';
import { PortfolioStatusService } from './portfolio-status.service';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule, NotificationsIntegrationModule],
  controllers: [PortfoliosController, PortfolioMessagesController, PortfolioStatusController],
  providers: [PortfoliosService, PortfolioMessagesService, PortfolioStatusService],
})
export class PortfoliosModule {}
