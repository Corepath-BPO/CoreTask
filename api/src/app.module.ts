import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

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
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommentsModule } from './modules/comments/comments.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectViewsModule } from './modules/project-views/project-views.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SectionsModule } from './modules/sections/sections.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
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
    UsersModule,
    WorkspacesModule,
    WorkspaceMembersModule,
    MembersModule,
    InvitationsModule,
    TeamsModule,
    ProjectsModule,
    ProjectViewsModule,
    CustomFieldsModule,
    SectionsModule,
    TasksModule,
    TicketsModule,
    CommentsModule,
    AttachmentsModule,
    ActivityLogsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    // Authentication is the default; `@Public()` opts a route out.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
