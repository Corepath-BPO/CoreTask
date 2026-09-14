import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { PasswordService } from '../auth/password.service';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ApiKeyAuthService } from './api-key-auth.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { IntegrationController } from './integration.controller';

/**
 * `ApiKeyAuthService` is exported because the global `JwtAuthGuard` needs it;
 * `PasswordService` is provided here directly rather than by importing the
 * whole auth module for one stateless hasher.
 */
@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule],
  controllers: [ApiKeysController, IntegrationController],
  providers: [ApiKeysService, ApiKeyAuthService, PasswordService],
  exports: [ApiKeyAuthService],
})
export class ApiKeysModule {}
