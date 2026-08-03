import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiPaginatedResponse, ApiSuccessResponse } from '@coretask/types';
import { map, type Observable } from 'rxjs';

import { PaginatedResult } from '../types/api.types';

type Envelope<T> = ApiSuccessResponse<T> | ApiPaginatedResponse<T>;

/**
 * Wraps every successful controller return value in the standard envelope.
 *
 * Controllers therefore return plain domain objects and never construct
 * `{ success, data, meta }` by hand. Errors bypass this and are shaped by
 * `AllExceptionsFilter`.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T>> {
    return next.handle().pipe(
      map((payload): Envelope<T> => {
        if (payload instanceof PaginatedResult) {
          return {
            success: true,
            data: payload.items as T[],
            meta: payload.meta,
          };
        }

        return { success: true, data: payload, meta: null };
      }),
    );
  }
}
