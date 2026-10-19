import { Module } from '@nestjs/common';

import { ConnectedAppsController, OAuthAppsController } from './oauth-apps.controller';
import { OAuthAppsService } from './oauth-apps.service';
import { OAuthTokenAuthService } from './oauth-token-auth.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

/**
 * OAuth 2.0 for connectors: app registration, consent, tokens.
 *
 * `OAuthTokenAuthService` is exported because the global `JwtAuthGuard`
 * authenticates `Bearer cto_…` requests with it.
 */
@Module({
  controllers: [OAuthController, OAuthAppsController, ConnectedAppsController],
  providers: [OAuthService, OAuthAppsService, OAuthTokenAuthService],
  exports: [OAuthTokenAuthService],
})
export class OAuthModule {}
