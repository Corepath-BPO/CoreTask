import {
  FORM_ANSWER_MAX,
  FORM_DESCRIPTION_MAX,
  FORM_NAME_MAX,
  FORM_QUESTION_KINDS,
  FORM_QUESTION_LABEL_MAX,
  MAX_FORM_QUESTIONS,
  TASK_TITLE_MAX_LENGTH,
  type FormQuestionKind,
  FORM_OPTION_MAX,
  MAX_FORM_OPTIONS,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class FormQuestionDto {
  @ApiProperty({ example: 'q-1', description: 'Kept across edits so answers stay matched.' })
  @IsString()
  @MaxLength(40)
  id!: string;

  @ApiProperty({ example: 'Property address' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(FORM_QUESTION_LABEL_MAX)
  label!: string;

  @ApiProperty({ enum: FORM_QUESTION_KINDS })
  @IsIn(FORM_QUESTION_KINDS)
  kind!: FormQuestionKind;

  @ApiProperty()
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ type: [String], description: 'A choice question’s options.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FORM_OPTIONS)
  @IsString({ each: true })
  @MaxLength(FORM_OPTION_MAX, { each: true })
  options?: string[];
}

class FormFieldsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(FORM_DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId?: string | null;

  @ApiPropertyOptional({ type: [FormQuestionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FORM_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => FormQuestionDto)
  questions?: FormQuestionDto[];
}

export class CreateFormDto extends FormFieldsDto {
  @ApiProperty({ example: 'Maintenance request' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(FORM_NAME_MAX)
  name!: string;
}

export class UpdateFormDto extends FormFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(FORM_NAME_MAX)
  name?: string;
}

export class SubmitFormDto {
  @ApiProperty({ example: 'Leaking tap in unit 4' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(FORM_ANSWER_MAX)
  details?: string | null;

  @ApiPropertyOptional({ description: 'Answers keyed by question id.' })
  @IsOptional()
  @IsObject()
  answers?: Record<string, string>;
}
