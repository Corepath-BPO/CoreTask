import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { StatusTemplatesController } from './status-templates.controller';
import { StatusTemplatesService } from './status-templates.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [StatusTemplatesController],
  providers: [StatusTemplatesService],
})
export class StatusTemplatesModule {}
