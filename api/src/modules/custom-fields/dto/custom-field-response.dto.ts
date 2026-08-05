import { COLOR_TOKENS, CUSTOM_FIELD_TYPES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class CustomFieldOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Support' })
  label!: string;

  @ApiProperty({ enum: COLOR_TOKENS, example: 'blue' })
  colorToken!: string;

  @ApiProperty({ nullable: true, example: null })
  customColor!: string | null;

  @ApiProperty({ example: 0 })
  position!: number;

  @ApiProperty({
    example: false,
    description: 'Archived options stay resolvable but are not offered.',
  })
  isArchived!: boolean;
}

export class CustomFieldDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ example: 'Department' })
  name!: string;

  @ApiProperty({ nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ enum: CUSTOM_FIELD_TYPES, example: 'SINGLE_SELECT' })
  type!: string;

  @ApiProperty({ example: false })
  isRequired!: boolean;

  @ApiProperty({ example: false })
  isArchived!: boolean;

  @ApiProperty({ example: 0 })
  position!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { textMode: 'SHORT' },
    description:
      'Type-specific configuration. Always complete — every default is filled in on write.',
  })
  settings!: Record<string, unknown>;

  @ApiProperty({ type: [CustomFieldOptionDto], description: 'Empty for non-select types.' })
  options!: CustomFieldOptionDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TaskCustomFieldValueDto {
  @ApiProperty({ format: 'uuid' })
  customFieldId!: string;

  @ApiProperty({ nullable: true, example: null })
  text!: string | null;

  @ApiProperty({ nullable: true, example: null })
  number!: number | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  date!: string | null;

  @ApiProperty({ nullable: true, example: null })
  checkbox!: boolean | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  optionIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  userIds!: string[];
}

export class RemoveFieldResultDto {
  @ApiProperty({ example: false, description: 'True when the field was removed outright.' })
  deleted!: boolean;

  @ApiProperty({ example: true, description: 'True when values existed, so it was archived.' })
  archived!: boolean;
}
