import { WorkspaceRole, type ApiKeyRole } from '@coretask/contracts';
import type { ApiKey as ApiKeyDto } from '@coretask/types';
import type { Prisma } from '@prisma/client';

/** The role lives on the membership, the single source of truth, so the row brings it along. */
export const apiKeyInclude = {
  createdBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
  user: { select: { memberships: { select: { workspaceId: true, role: true } } } },
} satisfies Prisma.ApiKeyInclude;

export type ApiKeyRow = Prisma.ApiKeyGetPayload<{ include: typeof apiKeyInclude }>;

export function toApiKeyDto(row: ApiKeyRow, now: Date = new Date()): ApiKeyDto {
  const membership = row.user.memberships.find((entry) => entry.workspaceId === row.workspaceId);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    prefix: row.prefix,
    role: (membership?.role ?? WorkspaceRole.MEMBER) as ApiKeyRole,
    userId: row.userId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expired: row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime(),
  };
}
