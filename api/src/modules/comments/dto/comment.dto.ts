import {
  COMMENT_MAX_LENGTH,
  COMMENT_MIN_LENGTH,
  COMMENT_PAGE_LIMIT,
  MAX_ATTACHMENTS_PER_COMMENT,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateCommentDto {
  @ApiProperty({
    example: '<p>Reproduced on staging — it only fails above 10 MB.</p>',
    description:
      'Rich text, sanitised on the way in. Plain text with @[Name](uuid) tokens is still accepted and converted.',
  })
  @trim()
  @IsString()
  @Length(COMMENT_MIN_LENGTH, COMMENT_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_ATTACHMENTS_PER_COMMENT,
    description: 'Files already uploaded to this item by the author, to show under this comment.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_COMMENT)
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

/**
 * Body is the only editable field. Author and parent are facts about the
 * comment: moving one to a different task would silently rewrite a conversation.
 */
export class UpdateCommentDto {
  @ApiProperty()
  @trim()
  @IsString()
  @Length(COMMENT_MIN_LENGTH, COMMENT_MAX_LENGTH)
  body!: string;
}

/**
 * A thread is read as its latest window, then older windows on demand.
 *
 * A cursor rather than a page number: a comment arriving between two
 * requests would shift an offset and show a line twice. Ids are UUID v7 and
 * therefore time-ordered, so "before this id" is exact. Declares its own
 * `limit` rather than extending `PaginationQueryDto` — the shared 100-row
 * ceiling is the wrong shape, and class-validator would enforce both.
 */
export class CommentListQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The `earliestId` of the previous page; returns comments older than it.',
  })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: COMMENT_PAGE_LIMIT,
    default: COMMENT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COMMENT_PAGE_LIMIT)
  limit: number = COMMENT_PAGE_LIMIT;
}
