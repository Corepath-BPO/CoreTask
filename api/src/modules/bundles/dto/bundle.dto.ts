import {
  BUNDLE_DESCRIPTION_MAX,
  BUNDLE_NAME_MAX,
  BUNDLE_PARTS,
  type BundlePart,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateBundleDto {
  @ApiProperty({ example: 'Lease renewal workflow' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(BUNDLE_NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUNDLE_DESCRIPTION_MAX)
  description?: string | null;

  @ApiProperty({ format: 'uuid', description: 'The project the bundle is taken from.' })
  @IsUUID()
  sourceProjectId!: string;

  @ApiPropertyOptional({ enum: BUNDLE_PARTS, isArray: true, description: 'All four when omitted.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BUNDLE_PARTS.length)
  @IsIn(BUNDLE_PARTS, { each: true })
  parts?: BundlePart[];
}

export class UpdateBundleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(BUNDLE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUNDLE_DESCRIPTION_MAX)
  description?: string | null;
}
