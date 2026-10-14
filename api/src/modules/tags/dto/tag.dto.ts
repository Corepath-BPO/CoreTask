import { COLOR_TOKENS, TAG_NAME_MAX, type ColorToken } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTagDto {
  @ApiProperty({ example: 'Urgent', maxLength: TAG_NAME_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TAG_NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ enum: COLOR_TOKENS })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  color?: ColorToken;
}

export class UpdateTagDto {
  @ApiPropertyOptional({ maxLength: TAG_NAME_MAX })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TAG_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ enum: COLOR_TOKENS })
  @IsOptional()
  @IsIn(COLOR_TOKENS)
  color?: ColorToken;
}

export class AddTaskTagDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'An existing tag.' })
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional({ description: 'A tag by name; made when none has it.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(TAG_NAME_MAX)
  name?: string;
}
