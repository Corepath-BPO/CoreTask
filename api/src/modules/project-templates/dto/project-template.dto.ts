import {
  BLUEPRINT_PARTS,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_NAME_MIN_LENGTH,
  PROJECT_TEMPLATE_DESCRIPTION_MAX,
  PROJECT_TEMPLATE_NAME_MAX,
  ProjectVisibility,
  type BlueprintPart,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateProjectTemplateDto {
  @ApiProperty({ format: 'uuid', description: 'The project it is taken from.' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'Lease renewal' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_TEMPLATE_NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROJECT_TEMPLATE_DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({ enum: BLUEPRINT_PARTS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BLUEPRINT_PARTS.length)
  @IsIn(BLUEPRINT_PARTS, { each: true })
  parts?: BlueprintPart[];
}

export class UpdateProjectTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_TEMPLATE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROJECT_TEMPLATE_DESCRIPTION_MAX)
  description?: string | null;
}

export class StartProjectDto {
  @ApiProperty({ example: 'Lease renewal — 12 Elm St' })
  @Transform(trim)
  @IsString()
  @Length(PROJECT_NAME_MIN_LENGTH, PROJECT_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ example: '2026-11-02', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ enum: ProjectVisibility })
  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  teamId?: string | null;
}

export class DuplicateProjectDto extends StartProjectDto {
  @ApiPropertyOptional({
    enum: BLUEPRINT_PARTS,
    isArray: true,
    description: 'Everything when left out.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BLUEPRINT_PARTS.length)
  @IsIn(BLUEPRINT_PARTS, { each: true })
  parts?: BlueprintPart[];
}
