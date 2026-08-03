import {
  DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
  WORKSPACE_SLUG_MAX_LENGTH,
  WORKSPACE_SLUG_MIN_LENGTH,
  WORKSPACE_SLUG_PATTERN,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Length, Matches, ValidateIf } from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Acme Product', minLength: WORKSPACE_NAME_MIN_LENGTH })
  @trim()
  @IsString()
  @Length(WORKSPACE_NAME_MIN_LENGTH, WORKSPACE_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    example: 'acme-product',
    description: 'Derived from the name when omitted. Must be globally unique.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(WORKSPACE_SLUG_MIN_LENGTH, WORKSPACE_SLUG_MAX_LENGTH)
  @Matches(WORKSPACE_SLUG_PATTERN, {
    message: 'Use lowercase letters, numbers and single hyphens.',
  })
  slug?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string;
}

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ example: 'Acme Product' })
  @IsOptional()
  @trim()
  @IsString()
  @Length(WORKSPACE_NAME_MIN_LENGTH, WORKSPACE_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ require_tld: false }, { message: 'Enter a valid URL.' })
  logoUrl?: string | null;
}
