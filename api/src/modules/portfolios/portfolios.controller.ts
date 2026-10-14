import type { Portfolio } from '@coretask/types';
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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  AddPortfolioProjectsDto,
  CreatePortfolioDto,
  SetPortfolioCapacityDto,
  SetPortfolioStarDto,
  UpdatePortfolioDto,
} from './dto/portfolio.dto';
import { PortfoliosService } from './portfolios.service';

@ApiTags('Portfolios')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/portfolios')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not allowed to change this portfolio')
export class PortfoliosController {
  constructor(private readonly portfolios: PortfoliosService) {}

  @Get()
  @ApiOperation({
    summary: 'The workspace’s portfolios',
    description:
      'Each lists only the projects the caller can open, and whether the caller starred it.',
  })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<Portfolio[]> {
    return this.portfolios.list(workspaceId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Create a portfolio' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreatePortfolioDto,
  ): Promise<Portfolio> {
    return this.portfolios.create(workspaceId, actor, {
      name: dto.name,
      description: dto.description ?? null,
      color: dto.color,
    });
  }

  @Patch(':portfolioId')
  @ApiParam({ name: 'portfolioId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename, describe or recolour a portfolio' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdatePortfolioDto,
  ): Promise<Portfolio> {
    return this.portfolios.update(workspaceId, portfolioId, actor, dto);
  }

  @Delete(':portfolioId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'portfolioId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a portfolio', description: 'Its projects are untouched.' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.portfolios.remove(workspaceId, portfolioId, actor);
  }

  @Post(':portfolioId/projects')
  @ApiParam({ name: 'portfolioId', format: 'uuid' })
  @ApiOperation({ summary: 'Add projects to a portfolio', description: 'Appended, in order.' })
  addProjects(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddPortfolioProjectsDto,
  ): Promise<Portfolio> {
    return this.portfolios.addProjects(workspaceId, portfolioId, actor, dto.projectIds);
  }

  @Delete(':portfolioId/projects/:projectId')
  @ApiParam({ name: 'portfolioId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Take a project out of a portfolio' })
  removeProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<Portfolio> {
    return this.portfolios.removeProject(workspaceId, portfolioId, projectId, actor);
  }

  @Put(':portfolioId/capacity/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'portfolioId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({
    summary: 'Set one person’s Workload capacity',
    description: 'Null returns them to the portfolio’s default.',
  })
  setCapacity(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Actor() actor: ActorContext,
    @Body() dto: SetPortfolioCapacityDto,
  ): Promise<Portfolio> {
    return this.portfolios.setCapacity(workspaceId, portfolioId, userId, actor, dto.capacity);
  }

  @Put(':portfolioId/star')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'portfolioId', format: 'uuid' })
  @ApiOperation({ summary: 'Star or unstar a portfolio, for the caller alone' })
  setStar(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
    @Body() dto: SetPortfolioStarDto,
  ): Promise<Portfolio> {
    return this.portfolios.setStar(workspaceId, portfolioId, actor, dto.starred);
  }
}
