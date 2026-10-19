import { TIME_ENTRY_MAX_MINUTES, TIME_ENTRY_NOTE_MAX } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class LogTimeDto {
  @ApiProperty({ example: 90, description: 'Whole minutes.' })
  @IsInt()
  @Min(1)
  @Max(TIME_ENTRY_MAX_MINUTES)
  minutes!: number;

  @ApiPropertyOptional({ example: '2026-10-13', description: 'Today when left out.' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TIME_ENTRY_NOTE_MAX)
  note?: string | null;
}

export class UpdateTimeEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TIME_ENTRY_MAX_MINUTES)
  minutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TIME_ENTRY_NOTE_MAX)
  note?: string | null;
}
