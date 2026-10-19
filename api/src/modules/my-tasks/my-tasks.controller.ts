import { MY_TASKS_BUCKETS, type MyTasksBucket, type MyTasksRules } from '@coretask/contracts';
import type { MyTaskPlacement } from '@coretask/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { MyTasksService } from './my-tasks.service';

class PlaceTaskDto {
  @ApiProperty({ enum: MY_TASKS_BUCKETS, example: 'TODAY' })
  @IsIn(MY_TASKS_BUCKETS)
  bucket!: MyTasksBucket;
}

class MyTaskPlacementDto {
  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ enum: MY_TASKS_BUCKETS })
  bucket!: MyTasksBucket;
}

@ApiTags('My Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/my-tasks/placements')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class MyTasksController {
  constructor(private readonly myTasks: MyTasksService) {}

  @Get()
  @ApiOperation({
    summary: 'Where the caller’s tasks sit in My Tasks',
    description: 'Only tasks someone moved; any task not listed is in Recently assigned.',
  })
  @ApiEnvelopeResponse(MyTaskPlacementDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<MyTaskPlacement[]> {
    return this.myTasks.placements(workspaceId, actor);
  }

  @Put(':taskId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiOperation({ summary: 'Move a task to one of the caller’s My Tasks sections' })
  @ApiEnvelopeResponse(MyTaskPlacementDto)
  @ApiErrorResponseDoc(404, 'No such task, or it is in a private project the caller is not in')
  place(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PlaceTaskDto,
  ): Promise<MyTaskPlacement> {
    return this.myTasks.place(workspaceId, taskId, actor, dto.bucket);
  }
}

class MyTasksRulesDto {
  @ApiPropertyOptional({ description: 'Move tasks due today or overdue into Do today.' })
  @IsOptional()
  @IsBoolean()
  dueToday?: boolean;

  @ApiPropertyOptional({ description: 'Move tasks due in the next seven days into Do next week.' })
  @IsOptional()
  @IsBoolean()
  dueThisWeek?: boolean;
}

@ApiTags('My Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/my-tasks/rules')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class MyTasksRulesController {
  constructor(private readonly myTasks: MyTasksService) {}

  @Get()
  @ApiOperation({ summary: 'The caller’s My Tasks auto-sort rules' })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<MyTasksRules> {
    return this.myTasks.rules(workspaceId, actor);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Turn the caller’s My Tasks auto-sort rules on or off' })
  set(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: MyTasksRulesDto,
  ): Promise<MyTasksRules> {
    return this.myTasks.setRules(workspaceId, actor, dto);
  }
}
