import {
  ACTIVITY_ENTITIES,
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_FEED_MAX_LIMIT,
  NOTIFICATION_TYPES,
  NotificationType,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description: 'Only entries that have not been read.',
    example: true,
  })
  @IsOptional()
  // A query string carries strings, so `?unreadOnly=false` would otherwise be
  // the truthy string "false" and quietly invert the filter.
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    isArray: true,
    enum: NOTIFICATION_TYPES,
    description: 'Repeatable. Omit for every type.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    // `?type=A` arrives as a string and `?type=A&type=B` as an array; the
    // handler should not have to care which.
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @IsEnum(NotificationType, { each: true })
  types?: NotificationType[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The `nextCursor` from the previous page.',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
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
