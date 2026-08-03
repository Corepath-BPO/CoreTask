import { WORKSPACE_ROLES } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `Workspace` / `WorkspaceSummary` in `@coretask/types`. */

export class WorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Acme Product' })
  name!: string;

  @ApiProperty({ example: 'acme-product' })
  slug!: string;

  @ApiProperty({ nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ nullable: true, example: null })
  logoUrl!: string | null;

  @ApiProperty({ example: 'CORE', description: 'Prefix for ticket keys, e.g. CORE-1001.' })
  ticketPrefix!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class WorkspaceSummaryDto extends WorkspaceDto {
  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'OWNER' })
  role!: string;

  @ApiProperty({ example: 4 })
  memberCount!: number;

  @ApiProperty({ example: 2 })
  projectCount!: number;
}

export class WorkspaceMemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'MEMBER' })
  role!: string;

  @ApiProperty({ format: 'date-time' })
  joinedAt!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      email: { type: 'string' },
      avatarUrl: { type: 'string', nullable: true },
    },
  })
  user!: { id: string; name: string; email: string; avatarUrl: string | null };
}
