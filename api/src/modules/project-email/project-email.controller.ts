import type { ProjectEmailSettings } from '@coretask/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { UpdateProjectEmailDto } from './dto/project-email.dto';
import { InboundEmailService, type InboundResult } from './inbound-email.service';
import { normalizeInbound, type UploadedPart } from './inbound-message';
import { InboundSecretGuard } from './inbound-secret.guard';
import { ProjectEmailService } from './project-email.service';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/email')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class ProjectEmailController {
  constructor(private readonly email: ProjectEmailService) {}

  @Get()
  @ApiOperation({ summary: "The project's email address and how mail to it is handled" })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectEmailSettings> {
    return this.email.get(workspaceId, projectId, actor);
  }

  @Patch()
  @ApiOperation({ summary: 'Change how mail to the project is handled' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateProjectEmailDto,
  ): Promise<ProjectEmailSettings> {
    return this.email.update(workspaceId, projectId, actor, dto);
  }

  @Post('address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Give the project a new address',
    description: 'The old address, and every reply address under it, stops working.',
  })
  resetAddress(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectEmailSettings> {
    return this.email.resetAddress(workspaceId, projectId, actor);
  }
}

/**
 * Where a mail provider delivers what it received for the inbound domain.
 * No account: the provider proves itself with the shared secret, checked by
 * the guard before a multipart body is read.
 */
@ApiTags('Projects')
@Controller('inbound')
export class InboundEmailController {
  constructor(private readonly inbound: InboundEmailService) {}

  @Public()
  @Post('email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InboundSecretGuard)
  // Generous per file: oversized ones are named in the task rather than
  // failing the whole delivery, which the provider would only retry.
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 60 * 1024 * 1024, files: 30 } }))
  @ApiOperation({
    summary: 'Receive an email for a project address',
    description:
      'Postmark JSON, SendGrid Inbound Parse, Mailgun routes, or { from, to, cc, subject, text, html, messageId, attachments }.',
  })
  @ApiErrorResponseDoc(401, 'Wrong inbound secret')
  @ApiErrorResponseDoc(404, 'This server does not receive email')
  async receive(
    @Body() body: Record<string, unknown> | undefined,
    @UploadedFiles() files: UploadedPart[] | undefined,
  ): Promise<{ results: InboundResult[] }> {
    return { results: await this.inbound.receive(normalizeInbound(body ?? {}, files ?? [])) };
  }
}
