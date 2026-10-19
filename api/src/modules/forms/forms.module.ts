import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { FormsController, PublicFormsController } from './forms.controller';
import { FormsService } from './forms.service';

@Module({
  imports: [TasksModule, ProjectAccessModule, WorkspaceMembersModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
})
export class FormsModule {}
