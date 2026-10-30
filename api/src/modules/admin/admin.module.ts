import { Module } from '@nestjs/common';

import { InvitationsModule } from '../invitations/invitations.module';
import { MembersModule } from '../members/members.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** The admin console. A leaf: nothing imports it. */
@Module({
  imports: [WorkspaceMembersModule, MembersModule, InvitationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
