import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITIES,
  ACTIVITY_FEED_LIMIT,
  ACTIVITY_FEED_MAX_LIMIT,
  ITEM_ACTIVITY_PAGE_LIMIT,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ActivityQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ACTIVITY_FEED_MAX_LIMIT,
    default: ACTIVITY_FEED_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_FEED_MAX_LIMIT)
  limit: number = ACTIVITY_FEED_LIMIT;
}

/** The task panel's feed: one item's stories, newest first, by cursor. */
export class ItemActivityQueryDto {
  @ApiProperty({ enum: ['TASK', 'TICKET'] })
  @IsIn(['TASK', 'TICKET'])
  entity!: 'TASK' | 'TICKET';

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The `nextCursor` of the previous page; returns stories older than it.',
  })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ITEM_ACTIVITY_PAGE_LIMIT,
    default: ITEM_ACTIVITY_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITEM_ACTIVITY_PAGE_LIMIT)
  limit: number = ITEM_ACTIVITY_PAGE_LIMIT;
}

export class ActivityActorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class ActivityEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ enum: ACTIVITY_ACTIONS, example: 'CREATED' })
  action!: string;

  @ApiProperty({ enum: ACTIVITY_ENTITIES, example: 'TICKET' })
  entity!: string;

  @ApiProperty({ format: 'uuid' })
  entityId!: string;

  @ApiProperty({ example: 'Reported CORE-1001: Attachment upload times out' })
  summary!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'What changed, in one of the story shapes from @coretask/contracts. Readers that do not know the shape fall back to `summary`.',
    example: {
      field: 'dueDate',
      before: null,
      after: { date: '2026-09-12T00:00:00.000Z', at: null },
    },
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({
    type: ActivityActorDto,
    nullable: true,
    description: 'Null for system-generated activity.',
  })
  actor!: ActivityActorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ItemActivityPageDto {
  @ApiProperty({ type: [ActivityEntryDto] })
  items!: ActivityEntryDto[];

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Pass back as `before`.' })
  nextCursor!: string | null;
}
