import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailChangeController } from './email-change.controller';
import { EmailChangeService } from './email-change.service';
import { PasswordService } from './password.service';
import { ReauthService } from './reauth.service';
import { SecurityNotices } from './security-notices';
import { SessionsController } from './sessions.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets are passed per sign/verify call because access and refresh tokens
    // use different keys — see TokenService.
    JwtModule.register({}),
  ],
  controllers: [AuthController, TwoFactorController, SessionsController, EmailChangeController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    JwtStrategy,
    TwoFactorService,
    ReauthService,
    SecurityNotices,
    EmailChangeService,
  ],
  exports: [AuthService, TokenService, PasswordService, ReauthService, SecurityNotices],
})
export class AuthModule {}
