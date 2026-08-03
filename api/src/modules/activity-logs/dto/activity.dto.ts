import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITIES,
  ACTIVITY_FEED_LIMIT,
  ACTIVITY_FEED_MAX_LIMIT,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
    type: ActivityActorDto,
    nullable: true,
    description: 'Null for system-generated activity.',
  })
  actor!: ActivityActorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
