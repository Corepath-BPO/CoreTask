import type { Section } from '@coretask/types';
import type { Prisma } from '@prisma/client';

const SECTION_INCLUDE = {
  _count: { select: { tasks: true } },
} satisfies Prisma.SectionInclude;

export const sectionInclude = SECTION_INCLUDE;

export type SectionWithCount = Prisma.SectionGetPayload<{ include: typeof SECTION_INCLUDE }>;

/**
 * Shared by both the sections and projects services — the board endpoint
 * returns sections nested inside a project, and the two must not diverge.
 */
export function toSectionDto(section: SectionWithCount): Section {
  return {
    id: section.id,
    workspaceId: section.workspaceId,
    projectId: section.projectId,
    name: section.name,
    position: section.position,
    taskCount: section._count.tasks,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  };
}
