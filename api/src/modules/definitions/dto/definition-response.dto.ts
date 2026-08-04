import { COLOR_TOKENS, STATUS_CATEGORIES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class StatusDefinitionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Null for a workspace-wide status the project inherits.',
  })
  projectId!: string | null;

  @ApiProperty({ example: 'In Progress' })
  name!: string;

  @ApiProperty({ example: 'in-progress', description: 'Stable machine name.' })
  slug!: string;

  @ApiProperty({ enum: STATUS_CATEGORIES, example: 'ACTIVE' })
  category!: string;

  @ApiProperty({ enum: COLOR_TOKENS, example: 'blue' })
  colorToken!: string;

  @ApiProperty({ nullable: true, example: null })
  customColor!: string | null;

  @ApiProperty({ nullable: true, example: null })
  icon!: string | null;

  @ApiProperty({ example: 2 })
  position!: number;

  @ApiProperty({ example: false })
  isDefault!: boolean;

  @ApiProperty({ example: false })
  isArchived!: boolean;
}

export class PriorityDefinitionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'High' })
  name!: string;

  @ApiProperty({ example: 'high' })
  slug!: string;

  @ApiProperty({ example: 3, description: 'Sort key; comparisons use this, not the name.' })
  level!: number;

  @ApiProperty({ enum: COLOR_TOKENS, example: 'orange' })
  colorToken!: string;

  @ApiProperty({ nullable: true, example: null })
  customColor!: string | null;

  @ApiProperty({ example: 3 })
  position!: number;

  @ApiProperty({ example: false })
  isDefault!: boolean;

  @ApiProperty({ example: false })
  isArchived!: boolean;
}
