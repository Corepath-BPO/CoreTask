import { Module } from '@nestjs/common';

import { StorageModule } from '../../integrations/storage/storage.module';
import { CommentsModule } from '../comments/comments.module';
import { FollowersModule } from '../followers/followers.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { InboundEmailService } from './inbound-email.service';
import { InboundSecretGuard } from './inbound-secret.guard';
import { InboundEmailController, ProjectEmailController } from './project-email.controller';
import { ProjectEmailService } from './project-email.service';

/** Email to a project: its address, and the mail that arrives there. */
@Module({
  imports: [
    TasksModule,
    CommentsModule,
    FollowersModule,
    ProjectAccessModule,
    StorageModule,
    WorkspaceMembersModule,
  ],
  controllers: [ProjectEmailController, InboundEmailController],
  providers: [ProjectEmailService, InboundEmailService, InboundSecretGuard],
})
export class ProjectEmailModule {}
