import type { ProjectFieldMetadata, Task } from '@coretask/types';

export interface Group {
  id: string;
  name: string;
  tasks: Task[];
}

/**
 * Groups rows by section, keeping the project's section order.
 *
 * Tasks with no section land in a trailing group rather than being hidden —
 * a task that is invisible in the only view that lists everything is a task
 * nobody will find again.
 */
export function groupBySection(
  tasks: Task[],
  metadata: ProjectFieldMetadata | undefined,
): Group[] {
  const sections = metadata?.sections ?? [];
  const bySection = new Map<string, Task[]>();

  for (const task of tasks) {
    const key = task.sectionId ?? '__none__';
    const bucket = bySection.get(key);
    if (bucket) bucket.push(task);
    else bySection.set(key, [task]);
  }

  /*
   * Every section, including the empty ones.
   *
   * A section that has been created but not filled is still part of the plan —
   * hiding it makes the List view disagree with the board about what the
   * project's structure is, and leaves nowhere to drop the first task.
   */
  const groups: Group[] = sections.map((section) => ({
    id: section.id,
    name: section.name,
    tasks: bySection.get(section.id) ?? [],
  }));

  const orphans = bySection.get('__none__');
  if (orphans?.length) {
    groups.push({ id: '__none__', name: 'No section', tasks: orphans });
  }

  return groups;
}
