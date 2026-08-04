import { ATTACHMENT_STATUSES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class AttachmentUploaderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

/** Note the absence of the storage key: it is never exposed to a client. */
export class AttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  taskId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  ticketId!: string | null;

  @ApiProperty({ example: 'design-review.pdf' })
  filename!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({
    example: 51_200,
    description: 'The size storage actually holds, not the one that was declared.',
  })
  sizeBytes!: number;

  @ApiProperty({ enum: ATTACHMENT_STATUSES, example: 'READY' })
  status!: string;

  @ApiProperty({ type: AttachmentUploaderDto, nullable: true })
  uploadedBy!: AttachmentUploaderDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class PresignedUploadDto {
  @ApiProperty({ type: AttachmentDto })
  attachment!: AttachmentDto;

  @ApiProperty({ description: 'PUT the bytes here. Short-lived.' })
  uploadUrl!: string;

  @ApiProperty({
    example: { 'Content-Type': 'application/pdf' },
    description:
      'Must be sent verbatim on the PUT — these headers are part of the signature, so a different value is rejected.',
  })
  uploadHeaders!: Record<string, string>;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;
}

export class AttachmentDownloadDto {
  @ApiProperty({ description: 'Short-lived, and always forces a download rather than a render.' })
  url!: string;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;
}

export class DeleteAttachmentResultDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
