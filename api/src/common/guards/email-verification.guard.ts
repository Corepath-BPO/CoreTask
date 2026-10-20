import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  ALLOW_UNVERIFIED_EMAIL_KEY,
  REQUIRE_VERIFIED_EMAIL_KEY,
} from '../decorators/email-verification.decorator';
import { AppException } from '../exceptions/app.exception';
import type { RequestWithUser } from '../types/api.types';

/**
 * Holds people to confirming their e-mail address. Registered globally, after
 * `JwtAuthGuard`, so the principal is already on the request.
 *
 * Only sessions are held to it. An API key's service account has no inbox,
 * and an OAuth app acts for a person who confirmed or not in their own
 * session — refusing the app would only confuse whoever wired it up.
 */
@Injectable()
export class EmailVerificationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const verification = request.user?.emailVerification;
    if (!verification || verification.verified) return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL_KEY, targets)) {
      throw AppException.forbidden('EMAIL_NOT_VERIFIED');
    }
    if (
      verification.overdue &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_EMAIL_KEY, targets)
    ) {
      throw AppException.forbidden('EMAIL_NOT_VERIFIED');
    }
    return true;
  }
}
