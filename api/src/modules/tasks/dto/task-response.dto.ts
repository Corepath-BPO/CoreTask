import { TASK_PRIORITIES, TASK_STATUSES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `Task*` in `@coretask/types`. */

export class TaskUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class TaskDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  projectId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sectionId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Set when this is a subtask.' })
  parentTaskId!: string | null;

  @ApiProperty({ example: 'Wire the dashboard summary endpoints' })
  title!: string;

  @ApiProperty({ nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ enum: TASK_STATUSES, example: 'IN_PROGRESS' })
  status!: string;

  @ApiProperty({ enum: TASK_PRIORITIES, example: 'HIGH' })
  priority!: string;

  @ApiProperty({ example: 2000, description: 'Fractional ordering within the section.' })
  position!: number;

  @ApiProperty({ format: 'date-time', nullable: true })
  startDate!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  dueDate!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description: 'Derived from `status`; never set directly.',
  })
  completedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Non-null means archived.' })
  archivedAt!: string | null;

  @ApiProperty({ nullable: true, example: 120 })
  estimatedMinutes!: number | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  assigneeId!: string | null;

  @ApiProperty({ type: TaskUserDto, nullable: true })
  assignee!: TaskUserDto | null;

  @ApiProperty({ format: 'uuid' })
  createdById!: string;

  @ApiProperty({ example: 3 })
  subtaskCount!: number;

  @ApiProperty({ example: 1 })
  completedSubtaskCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TaskProjectRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform Foundation' })
  name!: string;

  @ApiProperty({ example: 'PLAT' })
  key!: string;

  @ApiProperty({ example: '#6366F1' })
  color!: string;
}

export class TaskSectionRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;
}

export class TaskDetailDto extends TaskDto {
  @ApiProperty({ type: [TaskDto], description: 'One level deep; subtasks cannot nest further.' })
  subtasks!: TaskDto[];

  @ApiProperty({ type: TaskProjectRefDto, nullable: true })
  project!: TaskProjectRefDto | null;

  @ApiProperty({ type: TaskSectionRefDto, nullable: true })
  section!: TaskSectionRefDto | null;

  @ApiProperty({ type: TaskUserDto, nullable: true })
  createdBy!: TaskUserDto | null;
}

export class TaskListSummaryDto {
  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 17 })
  completed!: number;

  @ApiProperty({ example: 3, description: 'Past due and neither done nor cancelled.' })
  overdue!: number;

  @ApiProperty({ example: 5 })
  unassigned!: number;
}
