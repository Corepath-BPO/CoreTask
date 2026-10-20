import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { DomainTxtResolver } from './domain-txt-resolver';
import { OidcService } from './oidc.service';
import { SamlController } from './saml.controller';
import { SamlService } from './saml.service';
import { SsoAccountsService } from './sso-accounts.service';
import { SsoController } from './sso.controller';
import { SsoResponder } from './sso-responder';
import { WorkspaceSsoController } from './workspace-sso.controller';
import { WorkspaceSsoService } from './workspace-sso.service';

/**
 * Single sign-on: Google and Microsoft for anyone, and a SAML identity
 * provider per workspace, with the domains that workspace has proved.
 */
@Module({
  imports: [AuthModule, UsersModule, WorkspaceMembersModule, ActivityLogsModule],
  // SamlController first: its `saml/start` must be matched before
  // SsoController's `:provider/start`, and routes match in the order registered.
  controllers: [SamlController, SsoController, WorkspaceSsoController],
  providers: [
    OidcService,
    SamlService,
    SsoAccountsService,
    SsoResponder,
    WorkspaceSsoService,
    DomainTxtResolver,
  ],
})
export class SsoModule {}
