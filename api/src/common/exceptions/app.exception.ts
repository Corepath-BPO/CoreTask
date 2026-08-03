import { ERROR_CODE_MESSAGES, type ErrorCode } from '@coretask/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorDetails = Record<string, unknown> | null;

/**
 * The only exception type the application layer should throw.
 *
 * It carries a machine-readable {@link ErrorCode} alongside the HTTP status so
 * the global filter can render the standard error envelope without guessing.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(
    code: ErrorCode,
    status: HttpStatus,
    message: string = ERROR_CODE_MESSAGES[code],
    details: ErrorDetails = null,
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }

  static badRequest(code: ErrorCode = 'BAD_REQUEST', message?: string, details?: ErrorDetails) {
    return new AppException(code, HttpStatus.BAD_REQUEST, message, details ?? null);
  }

  static unauthorized(code: ErrorCode = 'UNAUTHORIZED', message?: string, details?: ErrorDetails) {
    return new AppException(code, HttpStatus.UNAUTHORIZED, message, details ?? null);
  }

  static forbidden(code: ErrorCode = 'FORBIDDEN', message?: string, details?: ErrorDetails) {
    return new AppException(code, HttpStatus.FORBIDDEN, message, details ?? null);
  }

  static notFound(
    code: ErrorCode = 'RESOURCE_NOT_FOUND',
    message?: string,
    details?: ErrorDetails,
  ) {
    return new AppException(code, HttpStatus.NOT_FOUND, message, details ?? null);
  }

  static conflict(code: ErrorCode = 'RESOURCE_CONFLICT', message?: string, details?: ErrorDetails) {
    return new AppException(code, HttpStatus.CONFLICT, message, details ?? null);
  }

  static unprocessable(
    code: ErrorCode = 'VALIDATION_FAILED',
    message?: string,
    details?: ErrorDetails,
  ) {
    return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY, message, details ?? null);
  }

  static serviceUnavailable(
    code: ErrorCode = 'SERVICE_UNAVAILABLE',
    message?: string,
    details?: ErrorDetails,
  ) {
    return new AppException(code, HttpStatus.SERVICE_UNAVAILABLE, message, details ?? null);
  }
}
