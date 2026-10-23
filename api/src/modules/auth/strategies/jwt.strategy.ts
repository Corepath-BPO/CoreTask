import type { AccessTokenPayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppException } from '../../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../../common/types/api.types';
import { AppConfigService } from '../../../config/app-config.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  /**
   * Re-reads the user, and their session, on every request.
   *
   * A 15-minute access token would otherwise keep working after the account is
   * disabled or the session is signed out from another device; one indexed
   * lookup that joins the session's live token is a fair price for that.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const found = await this.users.findWithSession(payload.sub, payload.sid);

    if (!found) {
      throw AppException.unauthorized('ACCESS_TOKEN_INVALID');
    }
    const { user, sessionLive } = found;
    // Signed out — here, elsewhere, or everywhere. The client refreshes on
    // this code, which fails too, and lands on the sign-in page.
    if (!sessionLive) {
      throw AppException.unauthorized('ACCESS_TOKEN_EXPIRED');
    }
    // A service account authenticates with its API key, never with a session
    // token — there is no way to mint one, so one that names it is forged.
    if (user.isServiceAccount) {
      throw AppException.unauthorized('ACCESS_TOKEN_INVALID');
    }
    if (!user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    const verified = user.emailVerifiedAt !== null;
    return {
      id: user.id,
      email: user.email,
      sessionId: payload.sid,
      emailVerification: {
        verified,
        overdue:
          !verified &&
          user.emailVerificationDueAt !== null &&
          user.emailVerificationDueAt.getTime() <= Date.now(),
      },
    };
  }
}
