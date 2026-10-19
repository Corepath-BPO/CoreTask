import type { DependencyDirection } from '@coretask/types';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

const DIRECTIONS: readonly DependencyDirection[] = ['BLOCKED_BY', 'BLOCKING'];

export class AddDependencyDto {
  @ApiProperty({ format: 'uuid', description: 'The task at the other end.' })
  @IsUUID()
  taskId!: string;

  @ApiProperty({
    enum: DIRECTIONS,
    description:
      '`BLOCKED_BY`: the task in the path waits on `taskId`. `BLOCKING`: `taskId` waits on it.',
  })
  @IsIn(DIRECTIONS)
  direction!: DependencyDirection;
}

/** Swagger models mirroring `@coretask/types`. */

export class RelationUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class TaskLikesDto {
  @ApiProperty({ example: 2 })
  count!: number;

  @ApiProperty()
  likedByMe!: boolean;

  @ApiProperty({ type: [RelationUserDto] })
  users!: RelationUserDto[];
}

export class DependencyProjectDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '#6366F1' })
  color!: string;
}

export class DependencyTaskDto {
  @ApiProperty({ format: 'uuid', description: 'The edge; what DELETE takes.' })
  dependencyId!: string;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  isCompleted!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true })
  dueDate!: string | null;

  @ApiProperty({ type: RelationUserDto, nullable: true })
  assignee!: RelationUserDto | null;

  @ApiProperty({ type: DependencyProjectDto, nullable: true })
  project!: DependencyProjectDto | null;
}

export class TaskDependenciesDto {
  @ApiProperty({ type: [DependencyTaskDto], description: 'What this task waits on.' })
  blockedBy!: DependencyTaskDto[];

  @ApiProperty({ type: [DependencyTaskDto], description: 'What waits on this task.' })
  blocking!: DependencyTaskDto[];
}
