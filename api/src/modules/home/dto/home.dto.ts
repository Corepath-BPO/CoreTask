import { HOME_NOTEPAD_MAX, HOME_WIDGETS, type HomeWidget } from '@coretask/contracts';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateHomeLayoutDto {
  @ApiPropertyOptional({ enum: HOME_WIDGETS, isArray: true, description: 'Shown, in order.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HOME_WIDGETS.length)
  @IsIn(HOME_WIDGETS, { each: true })
  widgets?: HomeWidget[];

  @ApiPropertyOptional({ description: 'The private notepad, plain text.' })
  @IsOptional()
  @IsString()
  @MaxLength(HOME_NOTEPAD_MAX)
  notepad?: string;
}
