import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AppDirectoryController } from './app-directory.controller';
import { AppDirectoryService } from './app-directory.service';
import { ConnectedAppsController, OAuthAppsController } from './oauth-apps.controller';
import { OAuthAppsService } from './oauth-apps.service';
import { OAuthTokenAuthService } from './oauth-token-auth.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

/**
 * OAuth 2.0 for connectors: app registration, consent, tokens, and each
 * workspace's app directory.
 *
 * `OAuthTokenAuthService` is exported because the global `JwtAuthGuard`
 * authenticates `Bearer cto_…` requests with it.
 */
@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule],
  controllers: [
    OAuthController,
    OAuthAppsController,
    ConnectedAppsController,
    AppDirectoryController,
  ],
  providers: [OAuthService, OAuthAppsService, OAuthTokenAuthService, AppDirectoryService],
  exports: [OAuthTokenAuthService],
})
export class OAuthModule {}
