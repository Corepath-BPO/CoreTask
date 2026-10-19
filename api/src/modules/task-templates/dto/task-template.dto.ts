import {
  MAX_TEMPLATE_SUBTASKS,
  RICH_TEXT_MAX_LENGTH,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_TEMPLATE_NAME_MAX,
  TASK_TITLE_MAX_LENGTH,
  type TaskKind,
  type TaskPriority,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TemplateSubtaskDto {
  @ApiProperty({ example: 'Draft the notice' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;
}

/** Shared by create and update; update makes every field optional below. */
class TemplateFieldsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(RICH_TEXT_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ enum: TASK_KINDS })
  @IsOptional()
  @IsIn(TASK_KINDS)
  kind?: TaskKind;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 365 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(365)
  dueInDays?: number | null;

  @ApiPropertyOptional({ type: [TemplateSubtaskDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMPLATE_SUBTASKS)
  @ValidateNested({ each: true })
  @Type(() => TemplateSubtaskDto)
  subtasks?: TemplateSubtaskDto[];
}

export class CreateTaskTemplateDto extends TemplateFieldsDto {
  @ApiProperty({ example: 'Lease renewal' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TEMPLATE_NAME_MAX)
  name!: string;

  @ApiProperty({ example: 'Renew the lease for …' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;
}

export class UpdateTaskTemplateDto extends TemplateFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TEMPLATE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;
}

export class UseTaskTemplateDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Defaults to the first section.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId?: string | null;
}
