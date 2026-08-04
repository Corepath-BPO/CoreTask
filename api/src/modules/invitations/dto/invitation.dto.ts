import { EMAIL_MAX_LENGTH, WORKSPACE_ROLES, WorkspaceRole } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsUUID, MaxLength, ValidateIf } from 'class-validator';

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

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Team to join on acceptance. Must belong to this workspace. Omit for no team.',
  })
  @IsOptional()
  // An untouched picker sends '', which means "no team" rather than a bad uuid.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  teamId?: string | null;
}
