import {
  MAX_PORTFOLIO_PROJECTS,
  PORTFOLIO_CAPACITY_MAX,
  PORTFOLIO_DESCRIPTION_MAX,
  PORTFOLIO_NAME_MAX,
  PORTFOLIO_WORKLOAD_MEASURES,
  type PortfolioWorkloadMeasure,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePortfolioDto {
  @ApiProperty({ example: 'Leasing programme' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PORTFOLIO_NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Every renewal workstream for 2026.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PORTFOLIO_DESCRIPTION_MAX)
  description?: string | null;

  @ApiProperty({ example: '#6366F1' })
  @IsHexColor()
  color!: string;
}

export class UpdatePortfolioDto {
  @ApiPropertyOptional({ example: 'Leasing programme' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PORTFOLIO_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PORTFOLIO_DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({ example: '#6366F1' })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ enum: PORTFOLIO_WORKLOAD_MEASURES })
  @IsOptional()
  @IsIn(PORTFOLIO_WORKLOAD_MEASURES)
  workloadMeasure?: PortfolioWorkloadMeasure;

  @ApiPropertyOptional({ nullable: true, example: 10 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(PORTFOLIO_CAPACITY_MAX)
  defaultCapacity?: number | null;
}

export class SetPortfolioCapacityDto {
  @ApiProperty({ nullable: true, example: 8, description: 'Null returns them to the default.' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(PORTFOLIO_CAPACITY_MAX)
  capacity!: number | null;
}

export class AddPortfolioProjectsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PORTFOLIO_PROJECTS)
  @IsUUID('all', { each: true })
  projectIds!: string[];
}

export class SetPortfolioStarDto {
  @ApiProperty()
  @IsBoolean()
  starred!: boolean;
}
