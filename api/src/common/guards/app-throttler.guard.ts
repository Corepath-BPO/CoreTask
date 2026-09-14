import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { RequestWithUser } from '../types/api.types';

/**
 * Rate limiting keyed by API key when one authenticated the request.
 *
 * The default tracker is the client IP, which would let one busy integration
 * throttle every other tool behind the same NAT — and let it exhaust the
 * browser users' allowance too. Runs after `JwtAuthGuard`, which is what puts
 * `request.user` in place.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req as unknown as RequestWithUser).user;

    if (user?.apiKey) {
      return `api-key:${user.apiKey.id}`;
    }

    return super.getTracker(req);
  }
}
