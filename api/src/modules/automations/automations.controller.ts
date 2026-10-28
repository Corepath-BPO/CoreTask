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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Actor, CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';

import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { AutomationMetadataService } from './builder/automation-metadata.service';
import { toGraph } from './builder/automation-graph.mapper';
import { ProjectAccessGuard } from '../project-access/project-access.guard';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AutomationDraftService } from './automation-draft.service';
import { AutomationsService } from './automations.service';
import {
  AutomationNodeDto,
  CreateRuleDto,
  DraftRuleDto,
  ExecutionsQueryDto,
  RevertRuleDto,
  RunRuleDto,
  UpdateRuleDto,
} from './dto/automation.dto';
import { AutomationDefinitionService } from './structured/automation-definition.service';

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
@UseGuards(WorkspaceMemberGuard, ProjectAccessGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not a manager for a write')
export class AutomationsController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly validator: AutomationGraphValidatorService,
    private readonly metadata: AutomationMetadataService,
    private readonly definitions: AutomationDefinitionService,
    private readonly drafts: AutomationDraftService,
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
      'The trigger, condition and action catalogues, plus the project’s own sections, ' +
      'statuses, priorities, members and custom fields. Read from the project so a form cannot ' +
      'offer a status the project does not define. Every entry carries `available`, derived ' +
      'from what the engine can actually run, and every unavailable one carries the reason.',
  })
  metadataForProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.metadata.forProject(workspaceId, projectId, role);
  }

  @Post('draft')
  @HttpCode(HttpStatus.OK)
  // A model call per request: a few a minute is plenty for somebody typing.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Draft a rule from a sentence, without saving it',
    description:
      'Asana’s “What do you want to automate?”. A model turns the sentence into a trigger, ' +
      'checks and actions, naming only this project’s own sections, people, statuses and ' +
      'fields. Returns the nodes in the shape the builder saves, what the validator says about ' +
      'them, and notes on anything asked for that is not in the draft. Creates nothing. ' +
      '`capabilities.ai` on the metadata says whether a model is set up.',
  })
  @ApiBody({ type: DraftRuleDto })
  @ApiErrorResponseDoc(422, 'No rule could be drafted from the sentence; the message says why')
  @ApiErrorResponseDoc(503, 'No model is set up, or it did not answer')
  draft(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: DraftRuleDto,
  ) {
    return this.drafts.draft(workspaceId, projectId, role, dto.prompt);
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
      allowChaining: rule.allowChaining,
      // Who to ask about it. The rule settings panel shows this, and a rule
      // nobody can be asked about is one nobody dares change.
      createdBy: rule.createdBy,
      publishedAt: rule.publishedAt?.toISOString() ?? null,
      // What is running, and whether the steps below say something else.
      ...(await this.automations.versionState(rule)),
      graph: toGraph(rule.nodes),
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  @Get(':ruleId/versions')
  @ApiOperation({
    summary: 'The versions a rule has published, newest first',
    description:
      'Publishing makes a version: the steps as they stood, which is what the rule runs until ' +
      'the next publish. Every run records the version it executed. `isPublished` marks the one ' +
      'running now.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  versions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.automations.versions(workspaceId, projectId, ruleId);
  }

  @Get(':ruleId/versions/:versionId')
  @ApiOperation({ summary: 'One published version, with its steps as a graph' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiParam({ name: 'versionId', format: 'uuid' })
  version(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.automations.version(workspaceId, projectId, ruleId, versionId);
  }

  @Post(':ruleId/versions/:versionId/revert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put an earlier version back',
    description:
      'Copies the version’s steps and trigger into the draft, where the builder shows them. ' +
      'Nothing running changes until the draft is published — or pass `publish: true` to ' +
      'publish it in the same call, refused exactly as Publish is. History is kept: publishing ' +
      'a restored version adds a new version with the old steps.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'Asked to publish, and the restored steps are not ready')
  revert(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: RevertRuleDto,
  ) {
    return this.automations.revert(
      workspaceId,
      projectId,
      role,
      ruleId,
      versionId,
      userId,
      dto.publish ?? false,
    );
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
    // fallback, so this also answers "is what I saved publishable?". The rows
    // need no conversion — they are already the shape the validator reads.
    const nodes = body.nodes ? body.nodes.map(toValidatableFromDto) : rule.nodes;

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
    description:
      'Supplying `nodes` replaces the whole canvas — the draft. A published rule goes on running ' +
      'the version it was published with until it is published again.',
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
      'Refuses everything `/validate` reports as an error — the checks the rule builder disables ' +
      'Publish for — plus a trigger naming a section that no longer exists. A rule with no ' +
      'action, an unknown trigger or action, a step nothing connects to, a comparison that does ' +
      'not fit the field, an id belonging to another project: each otherwise fails silently at ' +
      'run time. Warnings do not block. The stored graph is what gets checked, not a body.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The rule is not ready; the problems are listed in details')
  publish(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.automations.publish(workspaceId, projectId, role, ruleId, userId);
  }

  @Post(':ruleId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Run a manual rule on some tasks',
    description:
      'For a live rule whose trigger is “Rule is run manually”. Anyone who can edit the ' +
      'project’s tasks may run one. The runs are queued, one per task, and land in the rule’s ' +
      'history like any other.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The rule is not a live manual rule')
  runManually(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Actor() actor: ActorContext,
    @Body() dto: RunRuleDto,
  ) {
    return this.automations.runManually(
      workspaceId,
      projectId,
      ruleId,
      actor,
      dto.taskIds,
      dto.timezone,
    );
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
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    // A paused rule may have gone stale while it was off (deleted section,
    // removed member, unsupported action after a deployment). Resume through
    // the same validator as first publish instead of activating broken work.
    // Unchanged since it was paused, it goes back to the version it ran.
    return this.automations.publish(workspaceId, projectId, role, ruleId, userId);
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
  @ApiOperation({
    summary: 'Runs, newest first, with per-action logs',
    description:
      'Paged with `page` and `limit` (default 25); the page numbers and the total are in `meta`.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  executions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Query() query: ExecutionsQueryDto,
  ) {
    return this.automations.executions(workspaceId, projectId, ruleId, query);
  }

  /* ------------------------------------------------------------------------ */
  /* The structured rule                                                       */
  /* ------------------------------------------------------------------------ */

  /*
   * Alongside the graph routes above rather than replacing them. The node tree
   * is what every live rule still executes from, so both models are readable
   * for as long as the migration takes — the graph routes go when the runner
   * reads the published version, and not before.
   */

  @Get(':ruleId/definition')
  @ApiOperation({
    summary: 'Read the rule being edited, as a trigger and ordered branches',
    description:
      'Returns the draft version. A rule that has never been edited in this builder has its ' +
      'node tree converted on the first read, so an existing rule opens showing what it does ' +
      'rather than empty. `issues` says why `publishable` is false, and is answered on the read ' +
      'as well as the save because a rule can stop being publishable while nobody is looking — ' +
      'the section it names may have been deleted since.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  definition(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.definitions.getDraft(workspaceId, projectId, ruleId);
  }

  @Put(':ruleId/definition')
  @ApiOperation({
    summary: 'Save the whole rule into its draft version',
    description:
      'Replaces the draft’s branches wholesale — a builder sends the rule as it now stands, and ' +
      'reconciling that against stored rows means guessing which branch is “the same” one. ' +
      'An unfinished rule saves: a branch with no condition chosen yet, or an action not set up, ' +
      'is reported in `issues` and blocks publishing rather than the save. A rule that is wrong ' +
      'rather than unfinished — two “Check if” branches, an id from another workspace — is ' +
      'refused, because storing it only moves the failure to whoever reads it next. ' +
      'Nothing here changes what a published rule does.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiBody({
    description: 'A rule definition: `name`, `trigger`, and `branches` with their positions.',
    schema: { type: 'object' },
  })
  @ApiErrorResponseDoc(400, 'The rule cannot be stored as described; the reasons are in details')
  @ApiErrorResponseDoc(422, 'The body is not a rule definition')
  saveDefinition(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() body: unknown,
  ) {
    return this.definitions.saveDraft(workspaceId, projectId, role, ruleId, body);
  }

  @Post(':ruleId/definition/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make the draft the running version',
    description:
      'Refuses anything the rule builder would grey Publish out for, plus everything only the ' +
      'server can answer — a section from another project, a person no longer in the workspace, ' +
      'an action the engine has no code for. On success the draft becomes the published version ' +
      'and a copy of it becomes the new draft, so the version that is running is never the one ' +
      'anybody is editing.',
  })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The rule is not ready; the reasons are in details')
  publishDefinition(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.definitions.publish(workspaceId, projectId, userId, role, ruleId);
  }
}

/**
 * A node off the wire in the shape the validator reads — the stored one.
 *
 * The mapping goes this way round because publish validates the table, so the
 * row is what the validator speaks. A body coming the other way is the thing
 * that has to be translated, and doing it here means the two callers cannot
 * disagree about what a graph is: `/validate` answers about the same shape
 * `publish` will refuse.
 */
function toValidatableFromDto(node: AutomationNodeDto) {
  return {
    id: node.id ?? '',
    nodeType: node.nodeType,
    subtype: node.subtype,
    configuration: node.configuration ?? {},
    parentNodeId: node.parentId ?? null,
    branchKey: node.branchKey ?? null,
    // `order` on the wire, `position` in the table. The validator needs it
    // either way, because "the last branch" is a fact about this number rather
    // than about the order rows came back in.
    position: node.order,
  };
}
