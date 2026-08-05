import { WORK_ITEM_TYPES } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A status or priority already resolved to something a cell can draw. */
class WorkItemStateDto {
  @ApiProperty({
    description:
      'A status-definition uuid for a task, or the enum value when the task predates the ' +
      'definition backfill or the item is a ticket. Whatever comes out here is accepted back.',
    example: 'IN_PROGRESS',
  })
  id!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;

  @ApiProperty({ example: 'blue' })
  colorToken!: string;
}

class WorkItemUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
}

class WorkItemCustomFieldValueDto {
  @ApiProperty({ format: 'uuid' }) fieldId!: string;
  @ApiProperty({ nullable: true }) textValue!: string | null;
  @ApiProperty({ nullable: true }) numberValue!: number | null;
  @ApiProperty({ nullable: true }) dateValue!: string | null;
  @ApiProperty({ nullable: true }) booleanValue!: boolean | null;
  @ApiProperty({ type: [String] }) optionIds!: string[];
  @ApiProperty({ type: [String] }) userIds!: string[];
}

export class ProjectWorkItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({
    enum: WORK_ITEM_TYPES,
    description: 'MILESTONE and APPROVAL are declared but cannot be created yet.',
  })
  type!: string;

  @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null means unplaced.' })
  sectionId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Always null for a ticket.' })
  parentId!: string | null;

  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;

  @ApiProperty({
    description: 'Fractional, and shared with the other kind in the same section.',
  })
  position!: number;

  @ApiProperty({ type: WorkItemStateDto, nullable: true }) status!: WorkItemStateDto | null;
  @ApiProperty({ type: WorkItemStateDto, nullable: true }) priority!: WorkItemStateDto | null;

  @ApiProperty({ type: [WorkItemUserDto] }) assignees!: WorkItemUserDto[];

  @ApiProperty({ nullable: true }) startDate!: string | null;
  @ApiProperty({ nullable: true }) dueDate!: string | null;
  @ApiProperty({ nullable: true }) completedAt!: string | null;
  @ApiProperty({ nullable: true }) archivedAt!: string | null;

  @ApiProperty() subtaskCount!: number;
  @ApiProperty() completedSubtaskCount!: number;

  @ApiProperty({
    type: [WorkItemCustomFieldValueDto],
    description: 'Always empty for a ticket — there is nowhere to store one yet.',
  })
  customFieldValues!: WorkItemCustomFieldValueDto[];

  @ApiProperty({
    description:
      'Discriminated on `kind`. A ticket carries its key, severity and reporter here; ' +
      'a task carries its estimate.',
    example: { kind: 'TICKET', key: 'CORE-1042', severity: 'MAJOR' },
  })
  details!: Record<string, unknown>;

  @ApiProperty() createdById!: string;
  @ApiProperty({ type: WorkItemUserDto, nullable: true }) createdBy!: WorkItemUserDto | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ProjectWorkItemPageDto {
  @ApiProperty({ type: [ProjectWorkItemDto] }) items!: ProjectWorkItemDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Null when there is nothing further.' })
  nextCursor!: string | null;
}
