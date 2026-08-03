import { WorkspaceRole } from '@coretask/contracts';
import type { Ticket, TicketDetail, TicketListMeta } from '@coretask/types';
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
  ApiPaginatedEnvelopeResponse,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { PaginatedResult } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { TicketDetailDto, TicketDto } from './dto/ticket-response.dto';
import { CreateTicketDto, TicketListQueryDto, UpdateTicketDto } from './dto/ticket.dto';
import { TicketsService } from './tickets.service';

/**
 * Workspace-scoped: a ticket may arrive before anyone knows which project owns
 * it, and the queue is triaged across the whole workspace.
 *
 * There is no delete. `CLOSED` is the terminal state, and the audit trail is the
 * point of a ticket system — the record of what was reported and what happened
 * to it has to survive.
 */
@ApiTags('Tickets')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tickets')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @ApiOperation({
    summary: 'List tickets',
    description:
      'Filter by project, assignee or reporter (`me` resolves to the caller), status, type, priority, severity, due date, or a search that matches a key exactly and otherwise the title. Resolved and closed tickets are hidden unless `includeClosed=true` or an explicit `status` is given. `meta.summary` rolls up the workspace, not the page.',
  })
  @ApiPaginatedEnvelopeResponse(TicketDto)
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Query() query: TicketListQueryDto,
  ): Promise<PaginatedResult<Ticket, TicketListMeta>> {
    return this.tickets.list(workspaceId, userId, query);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Report a ticket',
    description:
      'The key is allocated by the server from the workspace prefix and counter. The caller becomes the reporter.',
  })
  @ApiEnvelopeResponse(TicketDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Unknown assignee, or a project outside this workspace')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTicketDto,
  ): Promise<Ticket> {
    return this.tickets.create(workspaceId, userId, dto);
  }

  @Get(':idOrKey')
  @ApiOperation({
    summary: 'Get a ticket',
    description: 'Accepts a UUID or a human key such as `CORE-1001`.',
  })
  @ApiParam({ name: 'idOrKey', example: 'CORE-1001' })
  @ApiEnvelopeResponse(TicketDetailDto)
  @ApiErrorResponseDoc(404, 'No such ticket in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
  ): Promise<TicketDetail> {
    return this.tickets.getDetail(workspaceId, idOrKey);
  }

  @Patch(':idOrKey')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Update a ticket',
    description:
      '`key`, `number` and the reporter are fixed. `resolvedAt` and `closedAt` are derived from `status`.',
  })
  @ApiParam({ name: 'idOrKey', example: 'CORE-1001' })
  @ApiEnvelopeResponse(TicketDto)
  @ApiErrorResponseDoc(400, 'No fields supplied, unknown assignee, or a foreign project')
  @ApiErrorResponseDoc(404, 'No such ticket in this workspace')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTicketDto,
  ): Promise<Ticket> {
    return this.tickets.update(workspaceId, userId, idOrKey, dto);
  }
}
