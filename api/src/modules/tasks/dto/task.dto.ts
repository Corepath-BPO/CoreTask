import {
  BOARD_TASK_LIMIT,
  DESCRIPTION_MAX_LENGTH,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  TASK_MAX_ESTIMATED_MINUTES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  TASK_TITLE_MIN_LENGTH,
  TaskPriority,
  TaskStatus,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** An emptied form input sends `''`; treat that as "clear this field". */
const emptyToNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  );

const booleanQuery = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
  });

/** `?status=TODO&status=DONE` and `?status=TODO,DONE` both arrive here. */
const csvArray = () =>
  Transform(({ value }: { value: unknown }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((entry) => entry.trim());
    return value;
  });

export class CreateTaskDto {
  @ApiProperty({ example: 'Wire the dashboard summary endpoints' })
  @trim()
  @IsString()
  @Length(TASK_TITLE_MIN_LENGTH, TASK_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  projectId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Must belong to `projectId`. Implies the project when that is omitted.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Creates a subtask.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentTaskId?: string | null;

  @ApiPropertyOptional({ enum: TASK_STATUSES, default: TaskStatus.TODO })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, default: TaskPriority.NONE })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

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

  @ApiPropertyOptional({ minimum: 0, maximum: TASK_MAX_ESTIMATED_MINUTES, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TASK_MAX_ESTIMATED_MINUTES)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Insert after this sibling. `null` places it first; omit to append.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  afterTaskId?: string | null;
}

/**
 * Placement is deliberately absent — `PATCH /tasks/:id/move` owns section and
 * ordering, so a field edit can never accidentally reshuffle the board.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim()
  @IsString()
  @Length(TASK_TITLE_MIN_LENGTH, TASK_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @trim()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

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

  @ApiPropertyOptional({ minimum: 0, maximum: TASK_MAX_ESTIMATED_MINUTES, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TASK_MAX_ESTIMATED_MINUTES)
  estimatedMinutes?: number | null;
}

export class MoveTaskDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Destination column. `null` detaches the task from any section.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Sibling to sit after within that column. `null` moves it to the top.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  afterTaskId!: string | null;
}

/**
 * Declares its own `page`/`limit` instead of extending `PaginationQueryDto`.
 *
 * A board loads a whole project in one request, which is well above the shared
 * 100-row ceiling. Extending and re-declaring would not work: class-validator
 * applies the inherited `@Max` as well, so both limits would be enforced.
 */
export class TaskListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION_DEFAULT_PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: BOARD_TASK_LIMIT,
    default: PAGINATION_DEFAULT_LIMIT,
    description: `Up to ${BOARD_TASK_LIMIT}, so a board can load a project in one request.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BOARD_TASK_LIMIT)
  limit: number = PAGINATION_DEFAULT_LIMIT;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Pass `me` to filter to the caller.',
  })
  @IsOptional()
  @trim()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({ enum: TASK_STATUSES, isArray: true })
  @IsOptional()
  @csvArray()
  @IsEnum(TaskStatus, { each: true })
  status?: TaskStatus[];

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, isArray: true })
  @IsOptional()
  @csvArray()
  @IsEnum(TaskPriority, { each: true })
  priority?: TaskPriority[];

  @ApiPropertyOptional({ description: 'Case-insensitive match on the title.' })
  @IsOptional()
  @trim()
  @IsString()
  @Length(1, TASK_TITLE_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Only tasks due on or before this.' })
  @IsOptional()
  @IsISO8601()
  dueBefore?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @booleanQuery()
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({
    default: false,
    description: 'By default only top-level tasks are returned; subtasks come with their parent.',
  })
  @IsOptional()
  @booleanQuery()
  @IsBoolean()
  includeSubtasks?: boolean = false;
}
