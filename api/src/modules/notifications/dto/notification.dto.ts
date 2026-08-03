import {
  ACTIVITY_ENTITIES,
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_FEED_MAX_LIMIT,
  NOTIFICATION_TYPES,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class NotificationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: NOTIFICATION_FEED_MAX_LIMIT,
    default: NOTIFICATION_FEED_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_FEED_MAX_LIMIT)
  limit: number = NOTIFICATION_FEED_LIMIT;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Omit to mark every unread notification in this workspace as read.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_FEED_MAX_LIMIT)
  @IsUUID(undefined, { each: true })
  notificationIds?: string[];
}

export class NotificationEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  workspaceId!: string | null;

  @ApiProperty({ enum: NOTIFICATION_TYPES, example: 'TICKET_ASSIGNED' })
  type!: string;

  @ApiProperty({ example: 'CORE-1001 was assigned to you' })
  title!: string;

  @ApiProperty({ nullable: true, example: 'Attachment upload times out' })
  body!: string | null;

  @ApiProperty({ enum: ACTIVITY_ENTITIES, nullable: true, example: 'TICKET' })
  entity!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  entityId!: string | null;

  @ApiProperty({ nullable: true, example: '/tickets/CORE-1001' })
  actionUrl!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Null while unread.' })
  readAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationFeedDto {
  @ApiProperty({ type: [NotificationEntryDto] })
  items!: NotificationEntryDto[];

  @ApiProperty({
    example: 3,
    description: 'Unread across the whole workspace, not just the returned page.',
  })
  unreadCount!: number;
}

export class MarkNotificationsReadResultDto {
  @ApiProperty({ example: 3 })
  updated!: number;

  @ApiProperty({ example: 0 })
  unreadCount!: number;
}
