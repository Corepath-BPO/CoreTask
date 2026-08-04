import { PROJECT_VIEW_SCOPES, PROJECT_VIEW_TYPES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class ProjectViewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ example: 'List' })
  name!: string;

  @ApiProperty({ enum: PROJECT_VIEW_TYPES, example: 'LIST' })
  type!: string;

  @ApiProperty({ enum: PROJECT_VIEW_SCOPES, example: 'PROJECT' })
  scope!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Set only for personal views.' })
  ownerUserId!: string | null;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({ example: false })
  isFavorite!: boolean;

  @ApiProperty({ example: 0 })
  position!: number;

  @ApiProperty({
    description: 'Columns, filters, sorts, grouping and density.',
    example: {
      columns: [{ field: 'title' }, { field: 'assigneeId' }],
      filters: { combinator: 'AND', conditions: [] },
      sorts: [],
      groupBy: 'sectionId',
      density: 'COMFORTABLE',
      showCompleted: true,
    },
  })
  settings!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DeleteViewResultDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}
