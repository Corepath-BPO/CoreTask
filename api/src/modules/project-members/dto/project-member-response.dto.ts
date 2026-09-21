import { PROJECT_MEMBER_ROLES } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Swagger models mirroring `ProjectMember` in `@coretask/types`. */

export class ProjectMemberUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Maya Okafor' })
  name!: string;

  @ApiProperty({ example: 'maya@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;

  @ApiPropertyOptional({ description: 'True for the account behind a workspace API key.' })
  isServiceAccount?: boolean;
}

export class ProjectMemberDto {
  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: PROJECT_MEMBER_ROLES, example: 'EDITOR' })
  role!: string;

  @ApiProperty({ type: ProjectMemberUserDto })
  user!: ProjectMemberUserDto;

  @ApiProperty({ format: 'date-time' })
  addedAt!: string;
}

export class RemoveProjectMemberResultDto {
  @ApiProperty({ description: 'False when they were not a member to begin with.' })
  removed!: boolean;
}

export class LeaveProjectResultDto {
  @ApiProperty({ description: 'False when the caller was not a member to begin with.' })
  left!: boolean;
}
