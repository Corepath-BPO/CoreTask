import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Saving a rule into the library.
 *
 * Addressed by rule rather than by posting a graph: what goes in the library is
 * something that already works somewhere, and letting a caller post an
 * arbitrary tree would make the library a second, unvalidated way to author
 * rules.
 */
export class SaveAutomationTemplateDto {
  @ApiProperty({ format: 'uuid', description: 'The project the rule belongs to.' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ format: 'uuid', description: 'The rule whose graph is saved.' })
  @IsUUID()
  ruleId!: string;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'Defaults to the rule’s own name.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Defaults to the rule’s description.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Leave out the sections, statuses, fields and options the rule names, so the template ' +
      'asks for them wherever it is used instead of carrying this project’s. People and ' +
      'priorities stay: they mean the same in every project.',
  })
  @IsOptional()
  @IsBoolean()
  clearReferences?: boolean;
}

export class UpdateAutomationTemplateDto {
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
}

export class ApplyAutomationTemplateDto {
  @ApiProperty({ format: 'uuid', description: 'The project the new draft is created in.' })
  @IsUUID()
  projectId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'A section in that project the trigger should watch, when the template was started ' +
      'from a section’s menu. Only read by a section-scoped trigger.',
  })
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}
