import { ApiProperty } from '@nestjs/swagger';

export class SectionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;

  @ApiProperty({
    example: 2000,
    description: 'Fractional ordering value; only meaningful relative to siblings.',
  })
  position!: number;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'Applied to a task moved into this section. Null means moving a card here changes only ' +
      'where it sits.',
  })
  defaultStatusId!: string | null;

  @ApiProperty({ example: 3 })
  taskCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
