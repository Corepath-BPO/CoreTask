import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { InboundEmailService } from './inbound-email.service';

/** Runs before the body's files are read: a stranger's upload goes nowhere. */
@Injectable()
export class InboundSecretGuard implements CanActivate {
  constructor(private readonly inbound: InboundEmailService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-inbound-secret'];
    this.inbound.authorize(
      request.headers.authorization,
      Array.isArray(header) ? header[0] : header,
    );
    return true;
  }
}
