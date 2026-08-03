import { Module } from '@nestjs/common';

import { WorkspaceMemberGuard } from './workspace-member.guard';
import { WorkspaceMembersService } from './workspace-members.service';

@Module({
  providers: [WorkspaceMembersService, WorkspaceMemberGuard],
  exports: [WorkspaceMembersService, WorkspaceMemberGuard],
})
export class WorkspaceMembersModule {}
