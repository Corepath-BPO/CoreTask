import { WORKSPACE_ROLES, WorkspaceRole } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateMemberRoleDto {
  @ApiProperty({
    enum: WORKSPACE_ROLES,
    example: WorkspaceRole.MANAGER,
    description:
      'Must not exceed the caller’s own role, and can never be OWNER — ownership is transferred through its own endpoint.',
  })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}

export class RemoveMemberResultDto {
  @ApiProperty({ example: true })
  removed!: boolean;

  @ApiProperty({
    example: 3,
    description: 'Open tasks unassigned, because the assignee can no longer see them.',
  })
  tasksUnassigned!: number;

  @ApiProperty({ example: 1 })
  ticketsUnassigned!: number;
}
