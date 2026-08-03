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
   * Re-reads the user on every request.
   *
   * A 15-minute access token would otherwise keep working after the account is
   * disabled; one indexed primary-key lookup is a fair price for that.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);

    if (!user) {
      throw AppException.unauthorized('ACCESS_TOKEN_INVALID');
    }
    if (!user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    return { id: user.id, email: user.email, sessionId: payload.sid };
  }
}
