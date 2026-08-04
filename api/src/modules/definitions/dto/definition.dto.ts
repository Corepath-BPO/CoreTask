import { COLOR_TOKENS, STATUS_CATEGORIES } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateStatusDto {
  @ApiProperty({ example: 'Waiting on customer', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    enum: STATUS_CATEGORIES,
    example: 'BLOCKED',
    description:
      'What the status means, kept separate from what it is called so rollups survive a rename.',
  })
  @IsIn(STATUS_CATEGORIES)
  category!: string;

  @ApiPropertyOptional({ enum: COLOR_TOKENS, default: 'gray' })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  colorToken?: string;
}

export class UpdateStatusDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ enum: STATUS_CATEGORIES })
  @IsOptional()
  @IsIn(STATUS_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ enum: COLOR_TOKENS })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  colorToken?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional({ description: 'Refused while tasks still hold this status.' })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class CreatePriorityDto {
  @ApiProperty({ example: 'Urgent', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    example: 5,
    minimum: 0,
    maximum: 100,
    description: 'Sort key. Comparisons use this, so renaming never changes what "higher" means.',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  level!: number;

  @ApiPropertyOptional({ enum: COLOR_TOKENS, default: 'gray' })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  colorToken?: string;
}

export class UpdatePriorityDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  level?: number;

  @ApiPropertyOptional({ enum: COLOR_TOKENS })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  colorToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class ReorderDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Every id, in the order they should appear. Position is the array index.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}
