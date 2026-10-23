import { Module } from '@nestjs/common';

import { StorageModule } from '../../integrations/storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { MembersModule } from '../members/members.module';
import { SlackModule } from '../slack/slack.module';
import { UsersModule } from '../users/users.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import {
  AccountDeletionController,
  WorkspaceDeletionController,
} from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { WorkspaceDeletionService } from './workspace-deletion.service';

/**
 * Deleting a workspace, and deleting an account. A leaf on purpose: it reaches
 * into auth, members, users, storage and Slack, so nothing may import it back
 * without closing a cycle.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    MembersModule,
    WorkspaceMembersModule,
    StorageModule,
    SlackModule,
  ],
  controllers: [AccountDeletionController, WorkspaceDeletionController],
  providers: [AccountDeletionService, WorkspaceDeletionService],
})
export class AccountDeletionModule {}
