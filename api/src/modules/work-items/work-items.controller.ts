import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ProjectWorkItem, ProjectWorkItemPage } from '@coretask/types';
import {
  createWorkItemSchema,
  moveWorkItemSchema,
  projectWorkItemQuerySchema,
  updateWorkItemSchema,
} from '@coretask/validation';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectWorkItemDto, ProjectWorkItemPageDto } from './dto/work-item-response.dto';
import { ProjectWorkItemService } from './project-work-item.service';

/**
 * Zod's issues, flattened to the shape the error envelope carries.
 *
 * The path is joined rather than sent as an array so a client can show it
 * beside a field without walking a structure — `assigneeIds.0` says which one.
 */
function invalid(
  message: string,
  error: { issues: readonly { path: PropertyKey[]; message: string }[] },
): never {
  throw AppException.unprocessable('VALIDATION_FAILED', message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/**
 * One entry point for a project's work items, whatever backs them.
 *
 * Both views call these routes. There is deliberately no `createFromList` or
 * `createFromBoard`: the endpoint describes what happens to the project, not
 * which screen asked, and a route per screen is how the two implementations
 * drifted far enough apart that one of them could not create anything at all.
 *
 * Bodies are validated with the same Zod schemas the client uses, so a rule
 * cannot hold on one side and not the other.
 */
@ApiTags('Work items')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/work-items')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
@ApiErrorResponseDoc(404, 'The project is not in this workspace')
export class WorkItemsController {
  constructor(private readonly workItems: ProjectWorkItemService) {}

  @Get()
  @ApiOperation({
    summary: 'Every work item in the project',
    description:
      'Tasks and tickets in one ordering, which is what both the List and the Board draw. ' +
      'They share a section’s position space, so the two kinds interleave by position rather ' +
      'than being concatenated.',
  })
  @ApiEnvelopeResponse(ProjectWorkItemPageDto)
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() rawQuery: Record<string, unknown>,
  ): Promise<ProjectWorkItemPage> {
    const parsed = projectWorkItemQuerySchema.safeParse(rawQuery);

    if (!parsed.success) {
      invalid('Invalid query.', parsed.error);
    }

    return this.workItems.list(workspaceId, projectId, parsed.data);
  }

  @Get(':workItemId')
  @ApiOperation({ summary: 'One work item' })
  @ApiEnvelopeResponse(ProjectWorkItemDto)
  async getOne(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
  ): Promise<ProjectWorkItem> {
    return this.workItems.getById(workspaceId, projectId, workItemId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a work item',
    description:
      'The one creation route, used by the List toolbar, the List section rows, the Board ' +
      'toolbar and the Board columns. A type with no model behind it is refused here as well ' +
      'as in the picker — a disabled menu item is presentation, not a check.',
  })
  @ApiEnvelopeResponse(ProjectWorkItemDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Unsupported type, a section from another project, or a bad parent')
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() body: unknown,
  ): Promise<ProjectWorkItem> {
    this.assertMayWrite(role);

    const parsed = createWorkItemSchema.safeParse(body);
    if (!parsed.success) {
      invalid('Invalid work item.', parsed.error);
    }

    return this.workItems.create(workspaceId, projectId, userId, parsed.data);
  }

  @Patch(':workItemId')
  @ApiOperation({
    summary: 'Update a work item',
    description:
      'Used by both views for every inline edit, so a title changed in the List and a title ' +
      'changed on a Board card take exactly the same path.',
  })
  @ApiEnvelopeResponse(ProjectWorkItemDto)
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() body: unknown,
  ): Promise<ProjectWorkItem> {
    this.assertMayWrite(role);

    const parsed = updateWorkItemSchema.safeParse(body);
    if (!parsed.success) {
      invalid('Invalid update.', parsed.error);
    }

    return this.workItems.update(workspaceId, projectId, userId, workItemId, parsed.data);
  }

  @Patch(':workItemId/move')
  @ApiOperation({
    summary: 'Move a work item to a section and position',
    description:
      'What a Board drag does, and what a List drag between section cards does. One route, so ' +
      'the resulting order is the same whichever one somebody used.',
  })
  @ApiEnvelopeResponse(ProjectWorkItemDto)
  async move(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() body: unknown,
  ): Promise<ProjectWorkItem> {
    this.assertMayWrite(role);

    const parsed = moveWorkItemSchema.safeParse(body);
    if (!parsed.success) {
      invalid('Invalid move.', parsed.error);
    }

    return this.workItems.move(workspaceId, projectId, userId, workItemId, parsed.data);
  }

  /**
   * Writing needs MEMBER; reading needs only membership, which the guard has
   * already established. A guest can look at a project without being able to
   * add to it — checked here rather than trusted from a hidden button.
   */
  private assertMayWrite(role: WorkspaceRole): void {
    if (!hasAtLeastRole(role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'You cannot change work in this project.');
    }
  }
}
