import {
  SAVED_SEARCH_NAME_MAX,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_QUERY_MAX_LENGTH,
} from '@coretask/contracts';
import type { SearchKind } from '@coretask/types';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SEARCH_KINDS: readonly SearchKind[] = ['tasks', 'tickets', 'projects', 'people'];

export class SearchQueryDto {
  @ApiProperty({ example: 'launch', maxLength: SEARCH_QUERY_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  q!: string;

  /**
   * One comma-separated parameter, as the work-item `types` filter takes it —
   * repeated or bracketed array parameters are refused by strict validation.
   */
  @ApiPropertyOptional({
    example: 'tasks,projects',
    description: `Narrow to these kinds: ${SEARCH_KINDS.join(', ')}. Omitted means all.`,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn(SEARCH_KINDS, { each: true })
  types?: SearchKind[];

  @ApiPropertyOptional({ minimum: 1, maximum: SEARCH_MAX_LIMIT, default: SEARCH_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit: number = SEARCH_DEFAULT_LIMIT;
}

export class RunTaskSearchDto {
  @ApiProperty({
    type: Object,
    description:
      'TaskSearchFilters: text, assigneeIds, projectIds, completion, due, createdByIds, collaboratorIds, sort.',
  })
  @IsObject()
  filters!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '2026-10-14',
    description: "The searcher's today, for due-date windows.",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  today?: string;
}

export class SaveSearchDto {
  @ApiProperty({ example: 'Overdue in Maintenance' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(SAVED_SEARCH_NAME_MAX)
  name!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  filters!: Record<string, unknown>;
}

export class UpdateSavedSearchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(SAVED_SEARCH_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}
