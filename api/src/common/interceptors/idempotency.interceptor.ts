import { createHash } from 'node:crypto';

import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_TTL_SECONDS,
} from '@coretask/contracts';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { from, type Observable, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';

import { RedisService } from '../../redis/redis.service';
import { AppException } from '../exceptions/app.exception';
import type { RequestWithUser } from '../types/api.types';

/**
 * How long a key is held while its first request is still running. Long enough
 * for any create to finish; short enough that a crash mid-request does not
 * lock the key out for a day.
 */
const IN_FLIGHT_TTL_SECONDS = 60;

interface StoredRecord {
  /** Method, path and body of the request that first used the key. */
  fingerprint: string;
  state: 'pending' | 'done';
  /** The controller's return value, before the envelope. */
  payload?: unknown;
}

/**
 * Makes a create safe to repeat.
 *
 * A caller sends `Idempotency-Key: <anything unique to the attempt>`; the first
 * request runs and its answer is kept for a day, keyed by caller and key. A
 * repeat with the same key and the same request gets that answer back, marked
 * `Idempotency-Replayed: true`, and creates nothing. The same key with a
 * different request is refused: it is a bug on the caller's side, and quietly
 * returning the wrong record would hide it.
 *
 * Route-scoped through `@Idempotent()`, which puts it inside the global
 * envelope interceptor: what is stored and replayed is the bare payload, and
 * the envelope is added on the way out both times.
 *
 * Losing Redis costs the guarantee, not the request — this is an internal tool,
 * and a duplicate task is cheaper than a stalled workflow.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redis: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithUser>();
    const key = headerValue(request.headers[IDEMPOTENCY_KEY_HEADER]);

    if (!key || !request.user) return next.handle();

    if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      );
    }

    const storeKey = `idem:${request.user.id}:${sha256(key)}`;
    const fingerprint = sha256(
      `${request.method} ${request.originalUrl}\n${JSON.stringify(request.body ?? null)}`,
    );

    let existing: StoredRecord | null;
    try {
      existing = await this.claim(storeKey, fingerprint);
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Idempotency store unavailable; handling the request without it',
      );
      return next.handle();
    }

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw AppException.unprocessable('IDEMPOTENCY_KEY_REUSED');
      }
      if (existing.state === 'pending') {
        throw AppException.conflict('IDEMPOTENCY_IN_PROGRESS');
      }

      http.getResponse<Response>().setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      return of(existing.payload);
    }

    return next.handle().pipe(
      mergeMap((payload) =>
        from(this.remember(storeKey, fingerprint, payload)).pipe(map(() => payload)),
      ),
      // A failed create must not be replayed as if it had worked, and the
      // caller's retry should get to run for real.
      catchError((error: unknown) =>
        from(this.release(storeKey)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  /** Takes the key if free (`null`), or returns whoever holds it. */
  private async claim(storeKey: string, fingerprint: string): Promise<StoredRecord | null> {
    const pending: StoredRecord = { fingerprint, state: 'pending' };
    const claimed = await this.redis.client.set(
      storeKey,
      JSON.stringify(pending),
      'EX',
      IN_FLIGHT_TTL_SECONDS,
      'NX',
    );
    if (claimed === 'OK') return null;

    const raw = await this.redis.client.get(storeKey);
    // Expired between the two calls: treat as free rather than fail the request.
    return raw ? (JSON.parse(raw) as StoredRecord) : null;
  }

  private async remember(storeKey: string, fingerprint: string, payload: unknown): Promise<void> {
    const done: StoredRecord = { fingerprint, state: 'done', payload };
    await this.redis.client.set(storeKey, JSON.stringify(done), 'EX', IDEMPOTENCY_TTL_SECONDS);
  }

  private async release(storeKey: string): Promise<void> {
    await this.redis.client.del(storeKey).catch(() => undefined);
  }
}

function headerValue(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
