import { IDEMPOTENCY_KEY_MAX_LENGTH } from '@coretask/contracts';
import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor';

/**
 * Lets a create be repeated safely with an `Idempotency-Key` header.
 *
 * For the routes machine callers hit — creating tasks, tickets, comments and
 * work items — where a retried request must not mean a second record. See
 * {@link IdempotencyInterceptor} for the rules.
 */
export const Idempotent = () =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        `Optional, up to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters. Repeat the same request with the same key ` +
        'within 24 hours and the first response comes back with `Idempotency-Replayed: true` ' +
        'instead of a second record. The same key with a different body is refused (422).',
    }),
  );
