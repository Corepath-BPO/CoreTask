import type { ColorToken } from '@coretask/contracts';
import type { TagRef } from '@coretask/types';
import type { Prisma } from '@prisma/client';

/** The tags on a task, alphabetical, as every task shape carries them. */
export const taskTagsInclude = {
  include: { tag: { select: { id: true, name: true, color: true } } },
  orderBy: { tag: { nameKey: 'asc' } },
} satisfies Prisma.Task$tagsArgs;

export function toTagRefs(
  rows: { tag: { id: string; name: string; color: string } }[] | undefined,
): TagRef[] {
  return (rows ?? []).map(({ tag }) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color as ColorToken,
  }));
}
