import { FORM_ANSWER_MAX } from '@coretask/contracts';
import type { ProjectForm, PublicForm } from '@coretask/types';
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { AUTH_THROTTLE } from '../../config/throttle.config';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { CreateFormDto, SubmitFormDto, UpdateFormDto } from './dto/form.dto';
import { FormsService } from './forms.service';

@ApiTags('Forms')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/forms')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not allowed to edit this project')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @ApiOperation({ summary: 'The project’s intake forms' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectForm[]> {
    return this.forms.list(workspaceId, projectId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Create a form', description: 'It gets its own unguessable link.' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateFormDto,
  ): Promise<ProjectForm> {
    return this.forms.create(workspaceId, projectId, actor, dto);
  }

  @Patch(':formId')
  @ApiParam({ name: 'formId', format: 'uuid' })
  @ApiOperation({ summary: 'Change a form, or turn it on or off' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('formId', ParseUUIDPipe) formId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateFormDto,
  ): Promise<ProjectForm> {
    return this.forms.update(workspaceId, projectId, formId, actor, dto);
  }

  @Delete(':formId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'formId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a form', description: 'Tasks it created stay.' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('formId', ParseUUIDPipe) formId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.forms.remove(workspaceId, projectId, formId, actor);
  }
}

/**
 * The public side of a form: reading it and submitting it, by link, with no
 * account. Throttled like sign-in, because it is the same kind of door.
 */
@ApiTags('Forms')
@Controller('public/forms')
@Throttle(AUTH_THROTTLE)
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'A form, as the public sees it' })
  @ApiErrorResponseDoc(404, 'No such form, or it is closed')
  read(@Param('token') token: string): Promise<PublicForm> {
    return this.forms.publicForm(token);
  }

  @Public()
  @Post(':token/submissions')
  @ApiOperation({ summary: 'Submit a form', description: 'Becomes a task in the project.' })
  @ApiErrorResponseDoc(404, 'No such form, or it is closed')
  submit(@Param('token') token: string, @Body() dto: SubmitFormDto): Promise<{ received: true }> {
    // Each answer held to the same limit the details are.
    for (const value of Object.values(dto.answers ?? {})) {
      if (typeof value !== 'string' || value.length > FORM_ANSWER_MAX) {
        throw AppException.badRequest('BAD_REQUEST', 'An answer is too long or not text.');
      }
    }
    return this.forms.submit(token, dto);
  }
}
