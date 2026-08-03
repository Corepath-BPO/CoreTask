import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@coretask/contracts';
import type { NextFunction, Request, Response } from 'express';

/** `pino-http` augments `IncomingMessage` with `id`; intersect rather than extend. */
type CorrelatedRequest = Request & { id?: string | number };

/**
 * Guarantees every request carries a correlation id, echoed back to the caller
 * and attached to each log line by the Pino configuration in `logger.config.ts`.
 *
 * Registered with `app.use()` rather than a Nest `MiddlewareConsumer`: it must
 * run before *everything*, including the logger, and a functional middleware
 * needs no route pattern (Express 5 rejects the bare `*` a consumer would emit).
 *
 * Idempotent — `pino-http`'s `genReqId` may have assigned `req.id` already, in
 * which case this only makes sure the response header is present.
 */
export function requestIdMiddleware(req: CorrelatedRequest, res: Response, next: NextFunction) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const existing = typeof req.id === 'string' ? req.id : undefined;

  const requestId =
    existing ?? (typeof incoming === 'string' && incoming.trim() !== '' ? incoming : randomUUID());

  req.id = requestId;
  req.headers[REQUEST_ID_HEADER] = requestId;

  if (!res.getHeader(REQUEST_ID_HEADER)) {
    res.setHeader(REQUEST_ID_HEADER, requestId);
  }

  next();
}
