import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `Team` and `TeamDetail` in `@coretask/types`. */

export class TeamMemberRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class TeamDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'Platform' })
  name!: string;

  @ApiProperty({ nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ example: '#6366F1' })
  color!: string;

  @ApiProperty({
    type: TeamMemberRefDto,
    nullable: true,
    description: 'Null when nobody leads the team, or the lead has left the workspace.',
  })
  lead!: TeamMemberRefDto | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  leadId!: string | null;

  @ApiProperty({ example: 4 })
  memberCount!: number;

  @ApiProperty({ example: 2, description: 'Projects currently assigned to this team.' })
  projectCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TeamDetailDto extends TeamDto {
  @ApiProperty({ type: TeamMemberRefDto, isArray: true })
  members!: TeamMemberRefDto[];
}
