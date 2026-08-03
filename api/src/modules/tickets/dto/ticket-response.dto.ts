import {
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
} from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `Ticket*` in `@coretask/types`. */

export class TicketUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class TicketDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  projectId!: string | null;

  @ApiProperty({
    example: 1001,
    description: 'Per-workspace sequence behind the key. Not a global identifier.',
  })
  number!: number;

  @ApiProperty({ example: 'CORE-1001', description: 'Stable for the ticket’s lifetime.' })
  key!: string;

  @ApiProperty({ example: 'Attachment upload times out on files above 10 MB' })
  title!: string;

  @ApiProperty({ nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ enum: TICKET_TYPES, example: 'BUG' })
  type!: string;

  @ApiProperty({ enum: TICKET_STATUSES, example: 'OPEN' })
  status!: string;

  @ApiProperty({ enum: TICKET_PRIORITIES, example: 'HIGH' })
  priority!: string;

  @ApiProperty({ enum: TICKET_SEVERITIES, example: 'MAJOR' })
  severity!: string;

  @ApiProperty({ format: 'uuid' })
  reporterId!: string;

  @ApiProperty({ type: TicketUserDto, nullable: true })
  reporter!: TicketUserDto | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  assigneeId!: string | null;

  @ApiProperty({ type: TicketUserDto, nullable: true })
  assignee!: TicketUserDto | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  dueDate!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'Derived from `status`; never set directly.',
  })
  resolvedAt!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'Derived from `status`; never set directly.',
  })
  closedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TicketProjectRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform Foundation' })
  name!: string;

  @ApiProperty({ example: 'PLAT' })
  key!: string;

  @ApiProperty({ example: '#6366F1' })
  color!: string;
}

export class TicketDetailDto extends TicketDto {
  @ApiProperty({ type: TicketProjectRefDto, nullable: true })
  project!: TicketProjectRefDto | null;
}

export class TicketListSummaryDto {
  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 17, description: 'Neither resolved nor closed.' })
  open!: number;

  @ApiProperty({ example: 2, description: 'Open and URGENT.' })
  urgent!: number;

  @ApiProperty({ example: 5, description: 'Open with nobody assigned.' })
  unassigned!: number;

  @ApiProperty({ example: 9 })
  resolved!: number;

  @ApiProperty({ example: 3, description: 'Open and past its due date.' })
  overdue!: number;
}
