import { AutomationRuleStatus, type WorkspaceRole } from '@coretask/contracts';
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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';

import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { AutomationMetadataService } from './builder/automation-metadata.service';
import { toGraph } from './builder/automation-graph.mapper';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AutomationsService } from './automations.service';
import { AutomationNodeDto, CreateRuleDto, UpdateRuleDto } from './dto/automation.dto';

/**
 * Project workflow rules.
 *
 * A rule is created as a DRAFT and only becomes live through `publish`, which
 * validates it. That ordering is deliberate: a half-built rule saved straight
 * to ACTIVE would start acting on real tasks before anyone had finished
 * describing what it should do.
 */
@ApiTags('Automations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/automations')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not a manager for a write')
export class AutomationsController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly validator: AutomationGraphValidatorService,
    private readonly metadata: AutomationMetadataService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the rules on a project' })
  @ApiQuery({
    name: 'sectionId',
    required: false,
    description: 'Only rules whose trigger watches this section.',
  })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.automations.list(workspaceId, projectId, sectionId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a rule',
    description: 'Always created as a DRAFT, whatever status is requested.',
  })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: CreateRuleDto,
  ) {
    return this.automations.create(workspaceId, projectId, userId, role, dto);
  }

  @Get('metadata')
  @ApiOperation({
    summary: 'What the builder’s forms can offer',
    description:
      'Triggers, actions, condition fields and the project’s own sections, statuses, ' +
      'priorities, members and fields. Read from the project so a form cannot offer a status ' +
      'the project does not define.',
  })
  metadataForProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.metadata.forProject(workspaceId, projectId);
  }

  @Get(':ruleId/graph')
  @ApiOperation({
    summary: 'Read one rule as a graph',
    description:
      'The same nodes as `GET :ruleId`, plus the edges the canvas draws. Edges are derived ' +
      'from each node’s parent rather than stored — `parentNodeId` already says what an edge ' +
      'row would, and keeping both is how two answers to one question start disagreeing.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  async graph(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    const rule = await this.automations.get(workspaceId, projectId, ruleId);

    return {
      id: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      description: rule.description,
      status: rule.status,
      version: rule.version,
      publishedAt: rule.publishedAt?.toISOString() ?? null,
      graph: toGraph(rule.nodes),
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  @Post(':ruleId/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check a graph without saving it',
    description:
      'Answers the same question Publish asks, so the builder can show why Publish is ' +
      'unavailable before anybody presses it. Warnings do not block publishing; errors do.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  async validateGraph(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() body: { name?: string; nodes?: AutomationNodeDto[] },
  ) {
    const rule = await this.automations.get(workspaceId, projectId, ruleId);

    // The body is what is on the canvas right now; the stored rule is the
    // fallback, so this also answers "is what I saved publishable?".
    const nodes = (body.nodes ?? rule.nodes.map(toValidatable)).map(toValidatableFromDto);

    return this.validator.validate(projectId, workspaceId, body.name ?? rule.name, nodes);
  }

  @Get(':ruleId')
  @ApiOperation({ summary: 'Read one rule with its nodes' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.automations.get(workspaceId, projectId, ruleId);
  }

  @Patch(':ruleId')
  @ApiOperation({
    summary: 'Update a rule',
    description: 'Supplying `nodes` replaces the whole canvas and bumps the version.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateRuleDto,
  ) {
    return this.automations.update(workspaceId, projectId, role, ruleId, dto);
  }

  @Post(':ruleId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate and activate a rule',
    description:
      'Refuses a rule with no action, an unknown trigger or action, or a trigger naming a section that no longer exists — each of which otherwise fails silently at run time.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The rule is not ready; the problems are listed in details')
  publish(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.automations.publish(workspaceId, projectId, role, ruleId);
  }

  @Post(':ruleId/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a rule running, keeping its definition' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  pause(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.automations.setStatus(
      workspaceId,
      projectId,
      role,
      ruleId,
      AutomationRuleStatus.PAUSED,
    );
  }

  @Post(':ruleId/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused rule' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  enable(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.automations.setStatus(
      workspaceId,
      projectId,
      role,
      ruleId,
      AutomationRuleStatus.ACTIVE,
    );
  }

  @Post(':ruleId/duplicate')
  @ApiOperation({ summary: 'Copy a rule as a new draft' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  duplicate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.automations.duplicate(workspaceId, projectId, userId, role, ruleId);
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a published rule, delete a draft',
    description:
      'A rule that has run explains why tasks look the way they do, and its executions point at it — so it is archived rather than destroyed.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.automations.remove(workspaceId, projectId, role, ruleId);
  }

  @Get(':ruleId/executions')
  @ApiOperation({ summary: 'Recent runs, with per-action logs' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  executions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.automations.executions(workspaceId, projectId, ruleId);
  }
}

/** A stored node in the shape the validator reads. */
function toValidatable(node: {
  id: string;
  nodeType: string;
  subtype: string;
  configuration: unknown;
  parentNodeId: string | null;
  branchKey: string | null;
}): AutomationNodeDto & { id: string; parentId: string | null; branchKey: string | null } {
  return {
    id: node.id,
    nodeType: node.nodeType,
    subtype: node.subtype,
    configuration: (node.configuration ?? {}) as Record<string, unknown>,
    parentId: node.parentNodeId,
    branchKey: node.branchKey,
  };
}

/** A node off the wire in the shape the validator reads. */
function toValidatableFromDto(node: AutomationNodeDto) {
  return {
    id: node.id ?? '',
    type: node.nodeType,
    subtype: node.subtype,
    configuration: node.configuration ?? {},
    parentId: node.parentId ?? null,
    branchKey: node.branchKey ?? null,
  };
}
