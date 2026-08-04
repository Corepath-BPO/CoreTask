import { PROJECT_VIEW_SCOPES, PROJECT_VIEW_TYPES } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectViewDto {
  @ApiProperty({ example: 'Sprint board', maxLength: 80 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: PROJECT_VIEW_TYPES, example: 'LIST' })
  @IsIn(PROJECT_VIEW_TYPES)
  type!: string;

  @ApiPropertyOptional({
    enum: PROJECT_VIEW_SCOPES,
    default: 'PROJECT',
    description: 'PERSONAL views are visible only to their owner.',
  })
  @IsOptional()
  @IsIn(PROJECT_VIEW_SCOPES)
  scope?: string;

  @ApiPropertyOptional({
    description:
      'Columns, filters, sorts, grouping and density. Validated against the shared view-settings schema; unknown keys are dropped.',
  })
  @IsOptional()
  @IsObject()
  settings?: unknown;
}

export class UpdateProjectViewDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: 'Replaces the settings document in full.' })
  @IsOptional()
  @IsObject()
  settings?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  position?: number;
}
