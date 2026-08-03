import {
  DESCRIPTION_MAX_LENGTH,
  HEX_COLOR_PATTERN,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_KEY_MIN_LENGTH,
  PROJECT_KEY_PATTERN,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_NAME_MIN_LENGTH,
  PROJECT_STATUSES,
  ProjectStatus,
} from '@coretask/contracts';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

const upper = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

/** Treats `''` as "clear this field", which is what an emptied form input sends. */
const emptyToNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  );

const booleanQuery = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
  });

export class CreateProjectDto {
  @ApiProperty({ example: 'Platform Foundation', minLength: PROJECT_NAME_MIN_LENGTH })
  @trim()
  @IsString()
  @Length(PROJECT_NAME_MIN_LENGTH, PROJECT_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    example: 'PLAT',
    description: 'Derived from the name when omitted. Unique within the workspace.',
  })
  @IsOptional()
  @upper()
  @IsString()
  @Length(PROJECT_KEY_MIN_LENGTH, PROJECT_KEY_MAX_LENGTH)
  @Matches(PROJECT_KEY_PATTERN, {
    message: 'Start with a letter, then letters and numbers only.',
  })
  key?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ enum: PROJECT_STATUSES, default: ProjectStatus.PLANNING })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ example: '#6366F1' })
  @IsOptional()
  @trim()
  @Matches(HEX_COLOR_PATTERN, { message: 'Enter a hex colour such as #6366F1.' })
  color?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Must be a member of this workspace.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadId?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  startDate?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  dueDate?: string | null;
}

/**
 * `key` is intentionally not updatable: it is embedded in every ticket
 * reference (`CORE-1001`), so changing it would invalidate links people have
 * already shared. That needs a dedicated migration flow, not a PATCH.
 */
export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim()
  @IsString()
  @Length(PROJECT_NAME_MIN_LENGTH, PROJECT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @trim()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ enum: PROJECT_STATUSES })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ example: '#0EA5E9' })
  @IsOptional()
  @trim()
  @Matches(HEX_COLOR_PATTERN, { message: 'Enter a hex colour such as #6366F1.' })
  color?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadId?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  startDate?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  dueDate?: string | null;
}

export class ProjectListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PROJECT_STATUSES })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ default: false, description: 'Include archived projects.' })
  @IsOptional()
  @booleanQuery()
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({ description: 'Case-insensitive match on name or key.' })
  @IsOptional()
  @trim()
  @IsString()
  @Length(1, PROJECT_NAME_MAX_LENGTH)
  search?: string;
}
