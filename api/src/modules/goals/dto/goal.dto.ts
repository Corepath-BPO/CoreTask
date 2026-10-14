import {
  GOAL_METRIC_UNIT_MAX,
  GOAL_NAME_MAX_LENGTH,
  GOAL_PROGRESS_SOURCES,
  GOAL_STATUSES,
  GOAL_TIME_PERIOD_MAX_LENGTH,
  type GoalProgressSource,
  type GoalStatus,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateGoalDto {
  @ApiProperty({ example: 'Grow annual revenue by 20%', maxLength: GOAL_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(GOAL_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'The goal this one supports.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  teamId?: string | null;

  @ApiPropertyOptional({
    example: 'Q4 FY26',
    nullable: true,
    maxLength: GOAL_TIME_PERIOD_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(GOAL_TIME_PERIOD_MAX_LENGTH)
  timePeriod?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ enum: GOAL_STATUSES })
  @IsOptional()
  @IsIn(GOAL_STATUSES)
  status?: GoalStatus;

  @ApiPropertyOptional({ enum: GOAL_PROGRESS_SOURCES })
  @IsOptional()
  @IsIn(GOAL_PROGRESS_SOURCES)
  progressSource?: GoalProgressSource;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Used when the source is MANUAL.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ nullable: true, description: 'A numeric goal: where it started.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  metricStart?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'A numeric goal: where it is now.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  metricCurrent?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'A numeric goal: where it is going.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  metricTarget?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 'leases', maxLength: GOAL_METRIC_UNIT_MAX })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(GOAL_METRIC_UNIT_MAX)
  metricUnit?: string | null;
}

export class UpdateGoalDto {
  @ApiPropertyOptional({ maxLength: GOAL_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(GOAL_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  teamId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: GOAL_TIME_PERIOD_MAX_LENGTH })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(GOAL_TIME_PERIOD_MAX_LENGTH)
  timePeriod?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ enum: GOAL_STATUSES })
  @IsOptional()
  @IsIn(GOAL_STATUSES)
  status?: GoalStatus;

  @ApiPropertyOptional({ enum: GOAL_PROGRESS_SOURCES })
  @IsOptional()
  @IsIn(GOAL_PROGRESS_SOURCES)
  progressSource?: GoalProgressSource;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ nullable: true, description: 'A numeric goal: where it started.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  metricStart?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'A numeric goal: where it is now.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  metricCurrent?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'A numeric goal: where it is going.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  metricTarget?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 'leases', maxLength: GOAL_METRIC_UNIT_MAX })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(GOAL_METRIC_UNIT_MAX)
  metricUnit?: string | null;
}

/** Swagger model mirroring `Goal` in `@coretask/types`. */
export class GoalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: GOAL_STATUSES })
  status!: GoalStatus;

  @ApiProperty({ enum: GOAL_PROGRESS_SOURCES })
  progressSource!: GoalProgressSource;

  @ApiProperty({ minimum: 0, maximum: 100, description: 'Stored or rolled up, per the source.' })
  progress!: number;

  @ApiProperty({ nullable: true, description: 'The owner, as a user reference.' })
  owner!: unknown;

  @ApiProperty({ nullable: true })
  team!: unknown;

  @ApiProperty({ nullable: true })
  timePeriod!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  dueDate!: string | null;

  @ApiProperty({ isArray: true, description: 'Connected projects the caller can see.' })
  projects!: unknown[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
