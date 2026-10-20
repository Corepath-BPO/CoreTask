import { CHECKLIST_ITEM_MAX, CHECKLIST_NAME_MAX, MAX_CHECKLIST_ITEMS } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateChecklistDto {
  @ApiProperty({ example: 'Move-in inspection', maxLength: CHECKLIST_NAME_MAX })
  @IsString()
  @MaxLength(CHECKLIST_NAME_MAX)
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Items to start it with, in order. Blank lines are dropped.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHECKLIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(CHECKLIST_ITEM_MAX, { each: true })
  items?: string[];
}

export class UpdateChecklistDto {
  @ApiPropertyOptional({ maxLength: CHECKLIST_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ description: 'Lower comes first among the task’s checklists.' })
  @IsOptional()
  @IsNumber()
  position?: number;
}

export class AddChecklistItemDto {
  @ApiProperty({ example: 'Keys handed over', maxLength: CHECKLIST_ITEM_MAX })
  @IsString()
  @MaxLength(CHECKLIST_ITEM_MAX)
  title!: string;
}

export class UpdateChecklistItemDto {
  @ApiPropertyOptional({ maxLength: CHECKLIST_ITEM_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CHECKLIST_ITEM_MAX)
  title?: string;

  @ApiPropertyOptional({ description: 'Ticks the item, or unticks it.' })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({ description: 'Lower comes first within the checklist.' })
  @IsOptional()
  @IsNumber()
  position?: number;
}
