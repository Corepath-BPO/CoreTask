import { LIST_VIEW_PAGE_SIZE, PAGINATION_DEFAULT_PAGE } from '@coretask/contracts';
import type { ProjectFieldMetadata, Task } from '@coretask/types';
import { filterConditionSchema, sortEntrySchema } from '@coretask/validation';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import type { PaginatedResult } from '../../common/types/api.types';
import { AppException } from '../../common/exceptions/app.exception';
import { TaskDto } from '../tasks/dto/task-response.dto';
import { TasksService } from '../tasks/tasks.service';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectFieldMetadataDto } from './dto/field-metadata.dto';
import { FieldMetadataService } from './field-metadata.service';

/**
 * Paging and search arrive as query parameters; filters and sorts do not.
 *
 * A filter set is a nested structure, and encoding one into a query string
 * means inventing a serialisation both sides have to agree on — which is how
 * injection surfaces get built. It goes in a POST body instead, validated by
 * the same Zod schemas a saved view uses.
 */
export class ProjectTaskQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION_DEFAULT_PAGE;

  @ApiPropertyOptional({ minimum: 1, maximum: LIST_VIEW_PAGE_SIZE, default: LIST_VIEW_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIST_VIEW_PAGE_SIZE)
  limit: number = LIST_VIEW_PAGE_SIZE;

  @ApiPropertyOptional({ description: 'Case-insensitive title search.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  filters?: { field: string; operator: string; value?: unknown }[];
  sorts?: { field: string; direction: string }[];
}

@ApiTags('Project views')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class ProjectTasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly metadata: FieldMetadataService,
  ) {}

  @Get('tasks/:taskId/subtasks')
  @ApiOperation({
    summary: 'The subtasks of one task',
    description:
      'Shaped exactly like the rows of a view, custom field values included, so an expanded row renders through the same cells as its parent. Fetched on expand rather than with the page: most rows are never opened, and loading every subtask up front would multiply the payload for something nobody asked to see.',
  })
  @ApiEnvelopeResponse(TaskDto, { isArray: true })
  @ApiErrorResponseDoc(404, 'No such task in this project')
  subtasks(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<Task[]> {
    return this.tasks.listSubtasksForView(workspaceId, projectId, taskId);
  }

  @Post('tasks/query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The tasks behind a view',
    description:
      'Filtering, sorting and paging all happen in PostgreSQL. A POST because a filter set is a nested structure, not something to encode into a query string.',
  })
  @ApiEnvelopeResponse(TaskDto, { isArray: true })
  @ApiErrorResponseDoc(400, 'A filter names a field this project does not have')
  async query(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ProjectTaskQueryDto,
    @Body() body: { filters?: unknown[]; sorts?: unknown[] } = {},
  ): Promise<PaginatedResult<Task>> {
    const filters = parseAll(body.filters, filterConditionSchema, 'filter');
    const sorts = parseAll(body.sorts, sortEntrySchema, 'sort');

    // Loaded once and handed to the compiler, so a filter naming twenty custom
    // fields still costs one query rather than twenty.
    const customFields = await this.metadata.customFieldMap(workspaceId, projectId);

    return this.tasks.listForView(
      workspaceId,
      projectId,
      { ...query, filters, sorts } as never,
      customFields,
    );
  }

  @Get('field-metadata')
  @ApiOperation({
    summary: 'Everything the Fields menu and filter builder need',
    description:
      'Custom fields, statuses, priorities, sections and members in one request, so opening a menu is not five round trips.',
  })
  @ApiEnvelopeResponse(ProjectFieldMetadataDto)
  fieldMetadata(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectFieldMetadata> {
    return this.metadata.forProject(workspaceId, projectId);
  }
}

/**
 * Validates each entry with the shared schema, reporting which one failed.
 *
 * The index matters: "filter 3 is invalid" is actionable where "invalid
 * request" sends someone hunting through a form.
 */
function parseAll<T>(
  input: unknown[] | undefined,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown } },
  label: string,
): T[] {
  if (!input?.length) return [];

  return input.map((entry, index) => {
    const parsed = schema.safeParse(entry);

    if (!parsed.success) {
      throw AppException.badRequest('BAD_REQUEST', `That ${label} is not valid.`, {
        index,
        issues: (parsed.error as { issues?: { path: unknown[]; message: string }[] })?.issues?.map(
          (issue) => ({ path: issue.path.join('.'), message: issue.message }),
        ),
      });
    }

    return parsed.data as T;
  });
}
