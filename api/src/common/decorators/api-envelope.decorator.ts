import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { ApiErrorDto, PaginationMetaDto } from '../dto/api-envelope.dto';

/**
 * Documents the standard success envelope for a single resource.
 *
 * Swagger only ever sees the unwrapped controller return type, so the envelope
 * added by `ResponseInterceptor` has to be described here to keep the published
 * OpenAPI document truthful.
 */
export function ApiEnvelopeResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: { status?: number; description?: string; isArray?: boolean } = {},
) {
  const { status = 200, description, isArray = false } = options;
  const dataSchema = isArray
    ? { type: 'array' as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', example: true },
          data: dataSchema,
          meta: { type: 'object', nullable: true, example: null },
        },
      },
    }),
  );
}

/** Documents the paginated variant, where `meta` carries page information. */
export function ApiPaginatedEnvelopeResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: { status?: number; description?: string } = {},
) {
  const { status = 200, description } = options;

  return applyDecorators(
    ApiExtraModels(model, PaginationMetaDto),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
}

/** Documents one error status using the shared error envelope. */
export function ApiErrorResponseDoc(status: number, description: string) {
  return applyDecorators(
    ApiExtraModels(ApiErrorDto),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          error: { $ref: getSchemaPath(ApiErrorDto) },
        },
      },
    }),
  );
}
