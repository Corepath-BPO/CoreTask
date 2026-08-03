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

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DeleteCommentResultDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
