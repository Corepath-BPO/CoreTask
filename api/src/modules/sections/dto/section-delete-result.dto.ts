import { ApiProperty } from '@nestjs/swagger';

export class SectionDeleteResultDto {
  @ApiProperty({ example: true })
  deleted!: boolean;

  @ApiProperty({
    example: 3,
    description: 'Tasks moved to the leftmost remaining section instead of being orphaned.',
  })
  reassignedTaskCount!: number;
}
