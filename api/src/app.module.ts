import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { buildLoggerOptions } from './config/logger.config';
import { PrismaModule } from './database/prisma.module';
import { EmailModule } from './integrations/email/email.module';
import { NotificationsIntegrationModule } from './integrations/notifications/notifications-integration.module';
import { StorageModule } from './integrations/storage/storage.module';
import { JobsModule } from './jobs/jobs.module';
import { ActivityLogsModule } from './modules/activity-logs/activity-logs.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuthModule } from './modules/auth/auth.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { CommentsModule } from './modules/comments/comments.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { DefinitionsModule } from './modules/definitions/definitions.module';
import { FollowersApiModule } from './modules/followers/followers-api.module';
import { FollowersModule } from './modules/followers/followers.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectViewsModule } from './modules/project-views/project-views.module';
import { WorkItemsModule } from './modules/work-items/work-items.module';
import { ProjectAccessModule } from './modules/project-access/project-access.module';
import { ProjectMembersModule } from './modules/project-members/project-members.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SectionsModule } from './modules/sections/sections.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkspaceMembersModule } from './modules/workspace-members/workspace-members.module';
import { MembersModule } from './modules/members/members.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { RedisModule } from './redis/redis.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    // Configuration first: everything below reads from it.
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: buildLoggerOptions,
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: seconds(config.rateLimit.ttlSeconds),
            limit: config.rateLimit.limit,
          },
        ],
      }),
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,
    JobsModule,
    WebsocketModule,

    // Integrations
    EmailModule,
    StorageModule,
    NotificationsIntegrationModule,

    // Domain
    AuthModule,
    ApiKeysModule,
    WebhooksModule,
    UsersModule,
    WorkspacesModule,
    WorkspaceMembersModule,
    MembersModule,
    InvitationsModule,
    TeamsModule,
    ProjectAccessModule,
    ProjectsModule,
    ProjectMembersModule,
    ProjectViewsModule,
    WorkItemsModule,
    CustomFieldsModule,
    DefinitionsModule,
    AutomationsModule,
    SectionsModule,
    TasksModule,
    TicketsModule,
    CommentsModule,
    FollowersModule,
    FollowersApiModule,
    AttachmentsModule,
    ActivityLogsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    // Authentication is the default; `@Public()` opts a route out. Session or
    // API key — the throttler runs after it so it can key on the principal.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
