import { PROJECT_STATUSES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

import { SectionDto } from '../../sections/dto/section-response.dto';

/** Swagger models mirroring `Project*` in `@coretask/types`. */

export class ProjectLeadDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class ProjectTeamRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform' })
  name!: string;

  @ApiProperty({ example: '#6366F1' })
  color!: string;

  @ApiProperty({
    enum: ['TASK', 'TICKET'],
    description: 'What the “+ Add” control creates without being asked.',
  })
  defaultWorkItemType!: 'TASK' | 'TICKET';
}

export class ProjectSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'Platform Foundation' })
  name!: string;

  @ApiProperty({ example: 'PLAT', description: 'Immutable once created.' })
  key!: string;

  @ApiProperty({ nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ enum: PROJECT_STATUSES, example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: '#6366F1' })
  color!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  leadId!: string | null;

  @ApiProperty({ type: ProjectLeadDto, nullable: true })
  lead!: ProjectLeadDto | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  teamId!: string | null;

  @ApiProperty({ type: ProjectTeamRefDto, nullable: true })
  team!: ProjectTeamRefDto | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  startDate!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  dueDate!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'Non-null means archived. Authoritative; `status` mirrors it.',
  })
  archivedAt!: string | null;

  @ApiProperty({ example: 22 })
  taskCount!: number;

  @ApiProperty({ example: 14 })
  completedTaskCount!: number;

  @ApiProperty({ example: 4 })
  sectionCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ProjectDetailDto extends ProjectSummaryDto {
  @ApiProperty({ type: [SectionDto], description: 'Ordered by position.' })
  sections!: SectionDto[];
}
