import {
  PROJECT_STATUS_VALUES,
  STATUS_TEMPLATE_NAME_MAX,
  STATUS_UPDATE_TEXT_MAX,
  type ProjectStatusValue,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Shared by create and update; update makes the name optional below. */
class StatusTemplateFieldsDto {
  @ApiPropertyOptional({ enum: PROJECT_STATUS_VALUES, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(PROJECT_STATUS_VALUES)
  status?: ProjectStatusValue | null;

  @ApiPropertyOptional({ nullable: true, example: 'What we finished this week:' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(STATUS_UPDATE_TEXT_MAX)
  summary?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(STATUS_UPDATE_TEXT_MAX)
  nextSteps?: string | null;
}

export class CreateStatusTemplateDto extends StatusTemplateFieldsDto {
  @ApiProperty({ example: 'Weekly update' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(STATUS_TEMPLATE_NAME_MAX)
  name!: string;
}

export class UpdateStatusTemplateDto extends StatusTemplateFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(STATUS_TEMPLATE_NAME_MAX)
  name?: string;
}
