import { ERROR_CODE_MESSAGES, type ErrorCode, REQUEST_ID_HEADER } from '@coretask/contracts';
import type { ApiErrorResponse } from '@coretask/types';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

import { AppException, type ErrorDetails } from '../exceptions/app.exception';

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details: ErrorDetails;
}

/**
 * Single exit point for every error leaving the HTTP layer.
 *
 * Guarantees the documented error envelope, keeps stack traces server-side, and
 * translates infrastructure errors (Prisma, throttler) into stable API codes.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const normalized = this.normalize(exception);

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception,
          requestId: request.headers[REQUEST_ID_HEADER],
          method: request.method,
          url: request.originalUrl,
        },
        `Unhandled error: ${normalized.message}`,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: normalized.code,
        // Internal failures never leak their real message to the client.
        message:
          this.isProduction && normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? ERROR_CODE_MESSAGES.INTERNAL_SERVER_ERROR
            : normalized.message,
        details: normalized.details,
      },
    };

    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: readMessage(exception.getResponse()) ?? ERROR_CODE_MESSAGES[exception.code],
        details: exception.details,
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMIT_EXCEEDED',
        message: ERROR_CODE_MESSAGES.RATE_LIMIT_EXCEEDED,
        details: null,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: ERROR_CODE_MESSAGES.BAD_REQUEST,
        details: null,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: exception instanceof Error ? exception.message : 'Unknown error',
      details: null,
    };
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    // The global ValidationPipe reports field errors as `message: string[]`.
    if (isValidationPayload(payload)) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'VALIDATION_FAILED',
        message: ERROR_CODE_MESSAGES.VALIDATION_FAILED,
        details: { fields: payload.message },
      };
    }

    return {
      status,
      code: statusToCode(status),
      message: readMessage(payload) ?? exception.message,
      details: null,
    };
  }

  private fromPrismaError(exception: Prisma.PrismaClientKnownRequestError): NormalizedError {
    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'RESOURCE_CONFLICT',
          message: ERROR_CODE_MESSAGES.RESOURCE_CONFLICT,
          details: { fields: normalizeTarget(exception.meta?.target) },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'RESOURCE_NOT_FOUND',
          message: ERROR_CODE_MESSAGES.RESOURCE_NOT_FOUND,
          details: null,
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'BAD_REQUEST',
          message: 'The referenced record does not exist.',
          details: null,
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Database error ${exception.code}`,
          details: null,
        };
    }
  }
}

const STATUS_CODE_MAP: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'RESOURCE_CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

function statusToCode(status: number): ErrorCode {
  return STATUS_CODE_MAP[status] ?? 'INTERNAL_SERVER_ERROR';
}

function isValidationPayload(payload: unknown): payload is { message: string[] } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    Array.isArray((payload as { message: unknown }).message)
  );
}

function readMessage(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return null;
}

function normalizeTarget(target: unknown): string[] {
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}
