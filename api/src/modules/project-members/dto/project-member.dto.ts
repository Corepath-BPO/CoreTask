import { EMAIL_MAX_LENGTH, PROJECT_MEMBER_ROLES, ProjectMemberRole } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsUUID, MaxLength } from 'class-validator';

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

export class InviteToProjectDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: EMAIL_MAX_LENGTH })
  // Lower-cased like a workspace invitation's, which this becomes.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    enum: PROJECT_MEMBER_ROLES,
    description:
      'Their role in this project. They join the workspace as a member, or as a guest for VIEWER.',
  })
  @IsEnum(ProjectMemberRole)
  role!: ProjectMemberRole;
}
