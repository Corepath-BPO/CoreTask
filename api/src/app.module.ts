import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { EmailVerificationGuard } from './common/guards/email-verification.guard';
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
import { AccountDeletionModule } from './modules/account-deletion/account-deletion.module';
import { ActivityLogsModule } from './modules/activity-logs/activity-logs.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuthModule } from './modules/auth/auth.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { BundlesModule } from './modules/bundles/bundles.module';
import { CommentsModule } from './modules/comments/comments.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { DefinitionsModule } from './modules/definitions/definitions.module';
import { FollowersApiModule } from './modules/followers/followers-api.module';
import { FollowersModule } from './modules/followers/followers.module';
import { GoalsModule } from './modules/goals/goals.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MyTasksModule } from './modules/my-tasks/my-tasks.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { ProjectViewsModule } from './modules/project-views/project-views.module';
import { WorkItemsModule } from './modules/work-items/work-items.module';
import { ProjectAccessModule } from './modules/project-access/project-access.module';
import { ProjectMembersModule } from './modules/project-members/project-members.module';
import { ProjectStarsModule } from './modules/project-stars/project-stars.module';
import { StatusTemplatesModule } from './modules/status-templates/status-templates.module';
import { TaskTemplatesModule } from './modules/task-templates/task-templates.module';
import { FormsModule } from './modules/forms/forms.module';
import { ProjectEmailModule } from './modules/project-email/project-email.module';
import { ProjectNotesModule } from './modules/project-notes/project-notes.module';
import { CalendarFeedsModule } from './modules/calendar-feeds/calendar-feeds.module';
import { ProjectExportModule } from './modules/project-export/project-export.module';
import { ProjectResourcesModule } from './modules/project-resources/project-resources.module';
import { TagsModule } from './modules/tags/tags.module';
import { HomeModule } from './modules/home/home.module';
import { ProjectTemplatesModule } from './modules/project-templates/project-templates.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PortfoliosModule } from './modules/portfolios/portfolios.module';
import { ProjectUpdatesModule } from './modules/project-updates/project-updates.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SearchModule } from './modules/search/search.module';
import { SectionsModule } from './modules/sections/sections.module';
import { TaskRelationsModule } from './modules/task-relations/task-relations.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { SlackModule } from './modules/slack/slack.module';
import { SsoModule } from './modules/sso/sso.module';
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
    SsoModule,
    ApiKeysModule,
    OAuthModule,
    WebhooksModule,
    SlackModule,
    UsersModule,
    WorkspacesModule,
    WorkspaceMembersModule,
    MembersModule,
    AccountDeletionModule,
    InvitationsModule,
    TeamsModule,
    ProjectAccessModule,
    ProjectsModule,
    ProjectStarsModule,
    ProjectUpdatesModule,
    PortfoliosModule,
    TaskTemplatesModule,
    FormsModule,
    ProjectEmailModule,
    TagsModule,
    ProjectNotesModule,
    CalendarFeedsModule,
    ProjectExportModule,
    ProjectResourcesModule,
    StatusTemplatesModule,
    BundlesModule,
    HomeModule,
    ReportsModule,
    ProjectTemplatesModule,
    ProjectMembersModule,
    ProjectViewsModule,
    WorkItemsModule,
    CustomFieldsModule,
    DefinitionsModule,
    AutomationsModule,
    SectionsModule,
    TasksModule,
    TaskRelationsModule,
    MyTasksModule,
    GoalsModule,
    TicketsModule,
    CommentsModule,
    FollowersModule,
    FollowersApiModule,
    AttachmentsModule,
    ActivityLogsModule,
    NotificationsModule,
    SearchModule,
    HealthModule,
  ],
  providers: [
    // Authentication is the default; `@Public()` opts a route out. Session or
    // API key — the throttler runs after it so it can key on the principal.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // An unconfirmed address past its deadline stops here, before any work.
    { provide: APP_GUARD, useClass: EmailVerificationGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
