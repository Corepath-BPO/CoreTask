import { WORKSPACE_ROLES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

export class InvitationInviterDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

/** Note the absence of a token: it exists in the e-mail link and nowhere else. */
export class WorkspaceInvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'MEMBER' })
  role!: string;

  @ApiProperty({ type: InvitationInviterDto, nullable: true })
  invitedBy!: InvitationInviterDto | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ example: false, description: 'Decided by the server, not the client clock.' })
  expired!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class WorkspaceInvitationPreviewDto {
  @ApiProperty({ example: 'CoreTask Demo' })
  workspaceName!: string;

  @ApiProperty({
    example: 'ada@example.com',
    description: 'The accepting account must sign in with this address.',
  })
  email!: string;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'MEMBER' })
  role!: string;

  @ApiProperty({ nullable: true, example: 'Demo Owner' })
  invitedByName!: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class AcceptInvitationResultDto {
  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'coretask-demo' })
  workspaceSlug!: string;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'MEMBER' })
  role!: string;
}
