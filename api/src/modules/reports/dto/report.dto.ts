import {
  MAX_REPORT_CHART_PROJECTS,
  MAX_REPORT_CHARTS,
  REPORT_CHART_KINDS,
  REPORT_CHART_TITLE_MAX,
  REPORT_COMPLETIONS,
  REPORT_DASHBOARD_NAME_MAX,
  REPORT_GROUP_BYS,
  ReportCompletion,
  ReportGroupBy,
  type ReportChartKind,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** A query string's list: `a,b` or repeated keys, as an array. */
const list = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value : typeof value === 'string' && value !== '' ? value.split(',') : [];

const flag = ({ value }: { value: unknown }) => value === true || value === 'true';

/** The question a chart asks, as `GET /reports/tasks` takes it. */
export class ReportQueryDto {
  @ApiProperty({ enum: REPORT_GROUP_BYS })
  @IsIn(REPORT_GROUP_BYS)
  groupBy: ReportGroupBy = ReportGroupBy.NONE;

  @ApiPropertyOptional({ enum: REPORT_COMPLETIONS })
  @IsOptional()
  @IsIn(REPORT_COMPLETIONS)
  completion: ReportCompletion = ReportCompletion.ALL;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(MAX_REPORT_CHART_PROJECTS)
  @IsUUID('all', { each: true })
  projectIds: string[] = [];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  overdueOnly = false;
}

export class ReportChartDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty({ example: 'Open work by assignee' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(REPORT_CHART_TITLE_MAX)
  title!: string;

  @ApiProperty({ enum: REPORT_CHART_KINDS })
  @IsIn(REPORT_CHART_KINDS)
  kind!: ReportChartKind;

  @ApiProperty({ enum: REPORT_GROUP_BYS })
  @IsIn(REPORT_GROUP_BYS)
  groupBy!: ReportGroupBy;

  @ApiProperty({ enum: REPORT_COMPLETIONS })
  @IsIn(REPORT_COMPLETIONS)
  completion!: ReportCompletion;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMaxSize(MAX_REPORT_CHART_PROJECTS)
  @IsUUID('all', { each: true })
  projectIds!: string[];

  @ApiProperty()
  @IsBoolean()
  overdueOnly!: boolean;
}

class DashboardFieldsDto {
  @ApiPropertyOptional({ type: [ReportChartDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REPORT_CHARTS)
  @ValidateNested({ each: true })
  @Type(() => ReportChartDto)
  charts?: ReportChartDto[];
}

export class CreateReportDashboardDto extends DashboardFieldsDto {
  @ApiProperty({ example: 'Leasing operations' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(REPORT_DASHBOARD_NAME_MAX)
  name!: string;
}

export class UpdateReportDashboardDto extends DashboardFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(REPORT_DASHBOARD_NAME_MAX)
  name?: string;
}
