import { ErrorCode } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger-only models describing the envelope produced by the interceptor/filter. */

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 137 })
  total!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;
}

export class ApiErrorDto {
  @ApiProperty({ enum: Object.values(ErrorCode), example: ErrorCode.RESOURCE_NOT_FOUND })
  code!: string;

  @ApiProperty({ example: 'The requested resource could not be found.' })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description: 'Structured context such as field-level validation errors.',
  })
  details!: Record<string, unknown> | null;
}
