import {
  PROJECT_APPS,
  PROJECT_APP_EVENTS,
  PROJECT_APP_NAME_MAX,
  type ProjectApp,
  type ProjectAppEvent,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateProjectAppDto {
  @ApiProperty({ enum: PROJECT_APPS })
  @IsIn(PROJECT_APPS)
  app!: ProjectApp;

  @ApiPropertyOptional({
    description: "The tool's incoming-webhook URL for a channel. Not needed with `slackChannelId`.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({
    example: 'C0123456789',
    description:
      'Slack only, once the workspace has the CoreTask Slack app: the channel the app posts to itself, with buttons on each task.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[CG][A-Z0-9]{2,31}$/, { message: 'That is not a Slack channel id.' })
  slackChannelId?: string;

  @ApiPropertyOptional({ example: '#maintenance' })
  @IsOptional()
  @IsString()
  @MaxLength(PROJECT_APP_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ enum: PROJECT_APP_EVENTS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROJECT_APP_EVENTS.length)
  @IsIn(PROJECT_APP_EVENTS, { each: true })
  events?: ProjectAppEvent[];
}

export class UpdateProjectAppDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PROJECT_APP_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ enum: PROJECT_APP_EVENTS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROJECT_APP_EVENTS.length)
  @IsIn(PROJECT_APP_EVENTS, { each: true })
  events?: ProjectAppEvent[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
