import type { WorkspaceRole } from '@coretask/contracts';
import type { Attachment, AttachmentDownload, PresignedUpload } from '@coretask/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AttachmentsService } from './attachments.service';
import {
  AttachmentDownloadDto,
  AttachmentDto,
  DeleteAttachmentResultDto,
  PresignedUploadDto,
} from './dto/attachment-response.dto';
import { CreateAttachmentDto } from './dto/attachment.dto';

/**
 * Files attached to tasks and tickets.
 *
 * Uploading is two calls with a direct-to-storage PUT in between, so the bytes
 * never pass through the API: request memory and timeouts stay bounded whatever
 * the file size. The cost of that is that nothing the client says about the file
 * is trustworthy until `confirm` reads the stored object back, which is why the
 * flow cannot be collapsed into a single request.
 */
@ApiTags('Attachments')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('attachments')
  @ApiOperation({
    summary: 'Declare a file and get somewhere to upload it',
    description:
      'Creates a pending attachment and returns a short-lived presigned PUT. The declared size and type shape that URL, but only what `confirm` finds in storage is recorded.',
  })
  @ApiEnvelopeResponse(PresignedUploadDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Unsupported type, oversized, or not exactly one parent')
  @ApiErrorResponseDoc(404, 'No such task or ticket in this workspace')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAttachmentDto,
  ): Promise<PresignedUpload> {
    return this.attachments.create(workspaceId, userId, dto);
  }

  @Post('attachments/:attachmentId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the bytes have landed',
    description:
      'Reads the stored object back and checks its real size and type before the attachment becomes visible. A mismatch deletes the object. Repeating the call on an already-confirmed attachment is a no-op.',
  })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiEnvelopeResponse(AttachmentDto)
  @ApiErrorResponseDoc(400, 'Nothing was uploaded, or it does not match what was declared')
  @ApiErrorResponseDoc(403, 'Only the uploader can confirm')
  confirm(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Attachment> {
    return this.attachments.confirm(workspaceId, userId, attachmentId);
  }

  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'List a task’s attachments' })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(AttachmentDto, { isArray: true })
  listForTask(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<Attachment[]> {
    return this.attachments.listForTask(workspaceId, taskId);
  }

  @Get('tickets/:idOrKey/attachments')
  @ApiOperation({ summary: 'List a ticket’s attachments' })
  @ApiParam({ name: 'idOrKey', example: 'CORE-1001' })
  @ApiEnvelopeResponse(AttachmentDto, { isArray: true })
  listForTicket(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
  ): Promise<Attachment[]> {
    return this.attachments.listForTicket(workspaceId, idOrKey);
  }

  @Get('attachments/:attachmentId/download')
  @ApiOperation({
    summary: 'Get a short-lived download URL',
    description:
      'The bucket is private, so the URL is the grant. It expires quickly and always forces a download rather than rendering in the browser.',
  })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiEnvelopeResponse(AttachmentDownloadDto)
  @ApiErrorResponseDoc(404, 'No such attachment in this workspace')
  download(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<AttachmentDownload> {
    return this.attachments.download(workspaceId, attachmentId);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an attachment',
    description: 'The uploader, or a workspace manager. Removes the stored object as well.',
  })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiEnvelopeResponse(DeleteAttachmentResultDto)
  @ApiErrorResponseDoc(403, 'Not the uploader, and not a manager')
  @ApiErrorResponseDoc(404, 'No such attachment in this workspace')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<{ deleted: true }> {
    return this.attachments.remove(workspaceId, userId, role, attachmentId);
  }
}
