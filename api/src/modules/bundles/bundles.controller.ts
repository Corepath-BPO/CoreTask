import type { Bundle, BundleApplyResult, BundleRefreshResult } from '@coretask/types';
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

import { BundlesService } from './bundles.service';
import { CreateBundleDto, UpdateBundleDto } from './dto/bundle.dto';

@ApiTags('Bundles')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/bundles')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a manager of the project involved')
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  @ApiOperation({ summary: 'The workspace’s bundles, with the projects each is on' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<Bundle[]> {
    return this.bundles.list(workspaceId, actor);
  }

  @Post()
  @ApiOperation({
    summary: 'Make a bundle from a project',
    description: 'Takes its sections, fields, rules and task templates — or the parts named.',
  })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateBundleDto,
  ): Promise<Bundle> {
    return this.bundles.create(workspaceId, actor, dto);
  }

  @Patch(':bundleId')
  @ApiParam({ name: 'bundleId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename a bundle, or change its description' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateBundleDto,
  ): Promise<Bundle> {
    return this.bundles.update(workspaceId, bundleId, actor, dto);
  }

  @Delete(':bundleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'bundleId', format: 'uuid' })
  @ApiOperation({
    summary: 'Delete a bundle',
    description: 'What it wrote into projects stays, as theirs.',
  })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.bundles.remove(workspaceId, bundleId, actor);
  }

  @Post(':bundleId/refresh')
  @ApiParam({ name: 'bundleId', format: 'uuid' })
  @ApiOperation({
    summary: 'Retake a bundle from its project and send it out',
    description: 'Reapplied to every project it is on that the caller manages.',
  })
  refresh(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Actor() actor: ActorContext,
  ): Promise<BundleRefreshResult> {
    return this.bundles.refresh(workspaceId, bundleId, actor);
  }

  @Put(':bundleId/projects/:projectId')
  @ApiParam({ name: 'bundleId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'Apply a bundle to a project, or bring it up to date',
    description: 'Adds missing sections and fields; replaces the bundle’s rules and templates.',
  })
  apply(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<BundleApplyResult> {
    return this.bundles.apply(workspaceId, bundleId, projectId, actor);
  }

  @Delete(':bundleId/projects/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'bundleId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'Take a bundle off a project',
    description: 'Its rules and templates go; sections and fields stay.',
  })
  detach(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.bundles.detach(workspaceId, bundleId, projectId, actor);
  }
}
