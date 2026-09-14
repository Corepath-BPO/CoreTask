import { ApiProperty } from '@nestjs/swagger';

/** Swagger model mirroring `Comment` in `@coretask/types`. */

export class CommentAuthorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;

  @ApiProperty({ required: false, description: 'True for the hidden account behind an API key.' })
  isServiceAccount?: boolean;
}

export class CommentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'Reproduced on staging — it only fails above 10 MB.' })
  body!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({
    type: CommentAuthorDto,
    nullable: true,
    description: 'Null when the author’s account has since been removed.',
  })
  author!: CommentAuthorDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Set when the parent is a task.' })
  taskId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Set when the parent is a ticket.' })
  ticketId!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'Non-null once the body has been changed.',
  })
  editedAt!: string | null;

  @ApiProperty({ type: [CommentAuthorDto], description: 'Members named in the body.' })
  mentions!: CommentAuthorDto[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Files posted with this comment; they belong to the task or ticket.',
  })
  attachments!: unknown[];

  @ApiProperty({ example: 2 })
  likeCount!: number;

  @ApiProperty({ description: 'Whether the caller has liked it.' })
  likedByMe!: boolean;

  @ApiProperty({ type: [CommentAuthorDto], description: 'The first few people who liked it.' })
  likedBy!: CommentAuthorDto[];

  @ApiProperty({ format: 'date-time', nullable: true })
  pinnedAt!: string | null;

  @ApiProperty({ type: CommentAuthorDto, nullable: true })
  pinnedBy!: CommentAuthorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DeleteCommentResultDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
