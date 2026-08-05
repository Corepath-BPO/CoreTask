import { COLOR_TOKENS, CUSTOM_FIELD_TYPES } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFieldOptionDto {
  @ApiProperty({ example: 'Support', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiPropertyOptional({ enum: COLOR_TOKENS, default: 'gray' })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  colorToken?: string;
}

export class UpdateFieldOptionDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ enum: COLOR_TOKENS })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  colorToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  position?: number;
}

export class CreateCustomFieldDto {
  @ApiProperty({ example: 'Department', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: CUSTOM_FIELD_TYPES, example: 'SINGLE_SELECT' })
  @IsIn(CUSTOM_FIELD_TYPES)
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /*
   * Type-specific configuration, kept as an object here and validated against
   * the field's own type in the service. `class-validator` cannot express
   * "these keys depend on the value of `type`", and a per-type DTO class would
   * mean nine of them plus a discriminator the service already knows.
   */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Type-specific settings, e.g. `{ "textMode": "LONG" }`. Validated against the field type; unknown keys are dropped.',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [CreateFieldOptionDto],
    description: 'Required for select types, refused for every other type.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateFieldOptionDto)
  options?: CreateFieldOptionDto[];
}

export class UpdateCustomFieldDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Replaces the settings document. Validated against the field type.',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  position?: number;

  // `type` is absent on purpose: changing it would strand every value already
  // written into the old type's column.
}

/**
 * One value, in whichever shape the field's type uses.
 *
 * A single DTO rather than one per type, because the service already has to
 * branch on the definition to validate — and it is the definition, not the
 * request, that decides which of these is read.
 */
export class SetCustomFieldValueDto {
  @ApiPropertyOptional({ description: 'TEXT, URL and EMAIL fields.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  text?: string | null;

  @ApiPropertyOptional({ description: 'NUMBER fields.' })
  @IsOptional()
  @IsNumber()
  number?: number | null;

  @ApiPropertyOptional({ format: 'date-time', description: 'DATE fields.' })
  @IsOptional()
  @IsDateString()
  date?: string | null;

  @ApiPropertyOptional({ description: 'CHECKBOX fields.' })
  @IsOptional()
  @IsBoolean()
  checkbox?: boolean | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Select fields. Must name live options of this field.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  optionIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'PEOPLE fields. Must be members of this workspace.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  userIds?: string[];
}
