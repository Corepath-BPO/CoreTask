import {
  DESCRIPTION_MAX_LENGTH,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_MAX_LIMIT,
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  TICKET_TITLE_MAX_LENGTH,
  TICKET_TITLE_MIN_LENGTH,
  TICKET_TYPES,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
  TicketType,
} from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

const emptyToNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  );

const booleanQuery = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
  });

/** `?status=OPEN&status=TRIAGED` and `?status=OPEN,TRIAGED` both arrive here. */
const csvArray = () =>
  Transform(({ value }: { value: unknown }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((entry) => entry.trim());
    return value;
  });

export class CreateTicketDto {
  @ApiProperty({ example: 'Attachment upload times out on files above 10 MB' })
  @trim()
  @IsString()
  @Length(TICKET_TITLE_MIN_LENGTH, TICKET_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  projectId?: string | null;

  @ApiPropertyOptional({ enum: TICKET_TYPES, default: TicketType.BUG })
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @ApiPropertyOptional({ enum: TICKET_STATUSES, default: TicketStatus.OPEN })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, default: TicketPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TICKET_SEVERITIES, default: TicketSeverity.MINOR })
  @IsOptional()
  @IsEnum(TicketSeverity)
  severity?: TicketSeverity;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  dueDate?: string | null;
}

/**
 * `key`, `number` and `reporterId` are deliberately not updatable. The key gets
 * quoted in conversations, commits and links, so it is fixed for the ticket's
 * lifetime; the reporter is a record of who filed it, not a setting.
 */
export class UpdateTicketDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim()
  @IsString()
  @Length(TICKET_TITLE_MIN_LENGTH, TICKET_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @trim()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  projectId?: string | null;

  @ApiPropertyOptional({ enum: TICKET_TYPES })
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TICKET_PRIORITIES })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TICKET_SEVERITIES })
  @IsOptional()
  @IsEnum(TicketSeverity)
  severity?: TicketSeverity;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  dueDate?: string | null;
}

export class TicketListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION_DEFAULT_PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PAGINATION_MAX_LIMIT,
    default: PAGINATION_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_MAX_LIMIT)
  limit: number = PAGINATION_DEFAULT_LIMIT;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Pass `me` to filter to the caller.' })
  @IsOptional()
  @trim()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Pass `me` to filter to the caller.' })
  @IsOptional()
  @trim()
  @IsString()
  reporterId?: string;

  @ApiPropertyOptional({ enum: TICKET_STATUSES, isArray: true })
  @IsOptional()
  @csvArray()
  @IsEnum(TicketStatus, { each: true })
  status?: TicketStatus[];

  @ApiPropertyOptional({ enum: TICKET_TYPES, isArray: true })
  @IsOptional()
  @csvArray()
  @IsEnum(TicketType, { each: true })
  type?: TicketType[];

  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, isArray: true })
  @IsOptional()
  @csvArray()
  @IsEnum(TicketPriority, { each: true })
  priority?: TicketPriority[];

  @ApiPropertyOptional({ enum: TICKET_SEVERITIES, isArray: true })
  @IsOptional()
  @csvArray()
  @IsEnum(TicketSeverity, { each: true })
  severity?: TicketSeverity[];

  @ApiPropertyOptional({
    description: 'Case-insensitive match on the title, or an exact key such as CORE-1001.',
  })
  @IsOptional()
  @trim()
  @IsString()
  @Length(1, TICKET_TITLE_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  dueBefore?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Resolved and closed tickets are excluded unless this is set.',
  })
  @IsOptional()
  @booleanQuery()
  @IsBoolean()
  includeClosed?: boolean = false;
}
