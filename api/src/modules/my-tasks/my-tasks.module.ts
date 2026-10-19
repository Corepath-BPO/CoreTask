import { Module } from '@nestjs/common';

import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { MyTasksController, MyTasksRulesController } from './my-tasks.controller';
import { MyTasksService } from './my-tasks.service';

@Module({
  imports: [TasksModule, WorkspaceMembersModule],
  controllers: [MyTasksController, MyTasksRulesController],
  providers: [MyTasksService],
})
export class MyTasksModule {}
