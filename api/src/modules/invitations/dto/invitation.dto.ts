import { EMAIL_MAX_LENGTH, WORKSPACE_ROLES, WorkspaceRole } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: EMAIL_MAX_LENGTH })
  // Lower-cased on the way in so the unique constraint on (workspace, e-mail)
  // is case-insensitive and one address cannot hold two invitations.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    enum: WORKSPACE_ROLES,
    example: WorkspaceRole.MEMBER,
    description: 'Must not exceed the inviter’s own role, and can never be OWNER.',
  })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
