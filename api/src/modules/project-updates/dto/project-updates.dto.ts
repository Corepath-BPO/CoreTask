import {
  PROJECT_MESSAGE_BODY_MAX,
  PROJECT_MESSAGE_REPLY_MAX,
  PROJECT_MESSAGE_TITLE_MAX,
  PROJECT_STATUS_VALUES,
  STATUS_UPDATE_TEXT_MAX,
  STATUS_UPDATE_TITLE_MAX,
  type ProjectStatusValue,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PostStatusUpdateDto {
  @ApiProperty({ enum: PROJECT_STATUS_VALUES, example: 'ON_TRACK' })
  @IsIn(PROJECT_STATUS_VALUES)
  status!: ProjectStatusValue;

  @ApiProperty({ example: 'Platform — Oct 10' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(STATUS_UPDATE_TITLE_MAX)
  title!: string;

  @ApiPropertyOptional({ example: 'Search and dependencies shipped; goals land next week.' })
  @IsOptional()
  @IsString()
  @MaxLength(STATUS_UPDATE_TEXT_MAX)
  summary?: string | null;

  @ApiPropertyOptional({ example: 'Close out the e2e suite and cut the release.' })
  @IsOptional()
  @IsString()
  @MaxLength(STATUS_UPDATE_TEXT_MAX)
  nextSteps?: string | null;
}

export class PostProjectMessageDto {
  @ApiProperty({ example: 'Kick-off notes' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_MESSAGE_TITLE_MAX)
  title!: string;

  @ApiProperty({ example: '<p>Here is where we landed.</p>', description: 'Rich text; sanitised.' })
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_MESSAGE_BODY_MAX)
  body!: string;
}

export class ReplyToMessageDto {
  @ApiProperty({ example: 'Thanks — looks good.' })
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_MESSAGE_REPLY_MAX)
  body!: string;
}
