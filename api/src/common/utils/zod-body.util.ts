import type { ZodType } from 'zod';

import { AppException } from '../exceptions/app.exception';

/**
 * Validates a request body with the same Zod schema the web client uses, so a
 * rule cannot hold on one side and not the other.
 *
 * Issues are flattened to the shape the error envelope carries. The path is
 * joined rather than sent as an array so a client can show it beside a field
 * without walking a structure — `assigneeIds.0` says which one.
 */
export function parseBody<TOutput>(
  schema: ZodType<TOutput>,
  body: unknown,
  message: string,
): TOutput {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw AppException.unprocessable('VALIDATION_FAILED', message, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}
