import type { ProjectSummary } from '@coretask/types';

import type { ProjectStatusUpdateValue } from '@/features/projects/hooks/use-project-updates';

export type TimelineSort = 'portfolio' | 'name' | 'start' | 'due';

export const TIMELINE_SORTS: { value: TimelineSort; label: string }[] = [
  { value: 'portfolio', label: 'Portfolio order' },
  { value: 'name', label: 'Name' },
  { value: 'start', label: 'Start date' },
  { value: 'due', label: 'Due date' },
];

/** What the Timeline's toolbar narrows and orders by; none of it is saved. */
export interface TimelineView {
  search: string;
  /** Statuses to keep; empty keeps every project. `none` is "no update yet". */
  statuses: ReadonlySet<ProjectStatusUpdateValue | 'none'>;
  /** Only projects the reader leads. */
  mine: boolean;
  /** Only projects with a start or a due date — the ones with a bar. */
  datedOnly: boolean;
  sort: TimelineSort;
}

export const DEFAULT_TIMELINE_VIEW: TimelineView = {
  search: '',
  statuses: new Set(),
  mine: false,
  datedOnly: false,
  sort: 'portfolio',
};

/** How many filters are on, for the Filter button's count. */
export function activeFilterCount(view: TimelineView): number {
  return (view.statuses.size > 0 ? 1 : 0) + (view.mine ? 1 : 0) + (view.datedOnly ? 1 : 0);
}

/**
 * The portfolio's projects as the Timeline shows them: matched by name,
 * narrowed by status, lead and dates, then ordered. Undated projects sort
 * after dated ones under a date sort, by name among themselves, so the bars
 * still read as a sequence.
 */
export function arrangeTimeline(
  projects: readonly ProjectSummary[],
  view: TimelineView,
  statusOf: (projectId: string) => ProjectStatusUpdateValue | null,
  meId: string | undefined,
): ProjectSummary[] {
  const needle = view.search.trim().toLowerCase();
  const kept = projects.filter((project) => {
    if (needle && !project.name.toLowerCase().includes(needle)) return false;
    if (view.statuses.size > 0 && !view.statuses.has(statusOf(project.id) ?? 'none')) return false;
    if (view.mine && project.lead?.id !== meId) return false;
    if (view.datedOnly && !project.startDate && !project.dueDate) return false;
    return true;
  });

  if (view.sort === 'portfolio') return kept;
  const byName = (a: ProjectSummary, b: ProjectSummary) => a.name.localeCompare(b.name);
  if (view.sort === 'name') return [...kept].sort(byName);
  const key = (project: ProjectSummary) =>
    view.sort === 'start' ? (project.startDate ?? project.dueDate) : (project.dueDate ?? null);
  return [...kept].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left && right) return left.localeCompare(right) || byName(a, b);
    if (left) return -1;
    if (right) return 1;
    return byName(a, b);
  });
}
