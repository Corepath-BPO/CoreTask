import { AUTOMATION_NODE_TYPES, AUTOMATION_TRIGGERS } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AutomationNodeDto {
  @ApiProperty({ enum: AUTOMATION_NODE_TYPES, example: 'ACTION' })
  @IsIn(AUTOMATION_NODE_TYPES)
  nodeType!: string;

  @ApiProperty({
    example: 'ASSIGN_USER',
    description: 'Checked against the executable set when the rule is published, not here.',
  })
  @IsString()
  @MaxLength(60)
  subtype!: string;

  @ApiPropertyOptional({ description: 'Shape depends on the subtype.' })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  /*
   * The graph fields. All optional, so a caller that only knows about a flat
   * list of steps — which is every caller written before the canvas — keeps
   * working and simply gets a rule with no parentage and no positions.
   */

  @ApiPropertyOptional({
    description:
      'The builder’s own id for this node, used to express parentage within one save. ' +
      'Mapped to a real id on write; never trusted as a database key.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiPropertyOptional({ description: 'Canvas coordinates. Absent means unplaced.' })
  @IsOptional()
  @IsObject()
  position?: { x: number; y: number };

  @ApiPropertyOptional({ description: 'The `id` of the node this follows. Null on the trigger.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @ApiPropertyOptional({ description: 'Which arm of a parent branch this hangs off.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchKey?: string | null;

  @ApiPropertyOptional({ description: 'Ordinal among siblings.' })
  @IsOptional()
  @IsNumber()
  order?: number;
}

export class CreateRuleDto {
  @ApiProperty({ example: 'Auto-assign incoming requests', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: AUTOMATION_TRIGGERS, example: 'TASK_MOVED_TO_SECTION' })
  @IsIn(AUTOMATION_TRIGGERS)
  triggerType!: string;

  @ApiPropertyOptional({
    description: 'Scopes the trigger, e.g. the section a move must land in.',
  })
  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [AutomationNodeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AutomationNodeDto)
  nodes?: AutomationNodeDto[];
}

export class UpdateRuleDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: AUTOMATION_TRIGGERS })
  @IsOptional()
  @IsIn(AUTOMATION_TRIGGERS)
  triggerType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [AutomationNodeDto],
    description: 'Replaces every node. Omit to leave the canvas untouched.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AutomationNodeDto)
  nodes?: AutomationNodeDto[];
}
