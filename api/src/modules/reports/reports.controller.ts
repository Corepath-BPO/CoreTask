import type { ReportDashboard, ReportResult } from '@coretask/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  CreateReportDashboardDto,
  ReportQueryDto,
  UpdateReportDashboardDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('report-dashboards')
  @ApiOperation({ summary: 'The workspace’s report dashboards' })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<ReportDashboard[]> {
    return this.reports.list(workspaceId);
  }

  @Post('report-dashboards')
  @ApiOperation({ summary: 'Make a report dashboard' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateReportDashboardDto,
  ): Promise<ReportDashboard> {
    return this.reports.create(workspaceId, actor, dto);
  }

  @Patch('report-dashboards/:dashboardId')
  @ApiParam({ name: 'dashboardId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename a dashboard, or change its charts' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateReportDashboardDto,
  ): Promise<ReportDashboard> {
    return this.reports.update(workspaceId, dashboardId, actor, dto);
  }

  @Delete('report-dashboards/:dashboardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'dashboardId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a dashboard (its owner, or a manager)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.reports.remove(workspaceId, dashboardId, actor);
  }

  @Get('reports/tasks')
  @ApiOperation({
    summary: 'The numbers behind one chart',
    description: 'Counted over the top-level tasks the caller can see.',
  })
  tasks(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: ReportQueryDto,
  ): Promise<ReportResult> {
    return this.reports.tasks(workspaceId, actor, query);
  }
}
