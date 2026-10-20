import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';

import { verifySlackRequest } from './lib/slack-signature';

/**
 * Lets through only what Slack signed with this app's signing secret, and
 * only for five minutes after it was signed. These routes have no session —
 * the signature is the whole of their authentication.
 */
@Injectable()
export class SlackSignatureGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.slack.signingSecret;
    if (!secret) throw AppException.notFound('SLACK_NOT_CONFIGURED');

    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = (name: string) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const signed = verifySlackRequest(secret, {
      timestamp: header('x-slack-request-timestamp'),
      signature: header('x-slack-signature'),
      body: request.rawBody?.toString('utf8') ?? '',
    });
    if (!signed) {
      throw AppException.unauthorized('UNAUTHORIZED', 'This request was not signed by Slack.');
    }
    return true;
  }
}
