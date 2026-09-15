import { PROJECT_MEMBER_ROLES, ProjectMemberRole } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class AddProjectMemberDto {
  @ApiProperty({ format: 'uuid', description: 'Must already be a member of this workspace.' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ enum: PROJECT_MEMBER_ROLES, default: ProjectMemberRole.EDITOR })
  @IsOptional()
  @IsEnum(ProjectMemberRole)
  role?: ProjectMemberRole;
}

export class UpdateProjectMemberRoleDto {
  @ApiProperty({ enum: PROJECT_MEMBER_ROLES })
  @IsEnum(ProjectMemberRole)
  role!: ProjectMemberRole;
}
