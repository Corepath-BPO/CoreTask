import {
  COMMENT_MAX_LENGTH,
  COMMENT_MIN_LENGTH,
  COMMENT_PAGE_LIMIT,
  PAGINATION_DEFAULT_PAGE,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, IsOptional, Length, Max, Min } from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateCommentDto {
  @ApiProperty({ example: 'Reproduced on staging — it only fails above 10 MB.' })
  @trim()
  @IsString()
  @Length(COMMENT_MIN_LENGTH, COMMENT_MAX_LENGTH)
  body!: string;
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
 * Declares its own `limit` rather than extending `PaginationQueryDto`: a thread
 * is read whole, and the shared 100-row ceiling is the wrong shape for it.
 * Extending and re-declaring would not work either — class-validator applies the
 * inherited `@Max` as well, so both limits would be enforced.
 */
export class CommentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION_DEFAULT_PAGE;

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
