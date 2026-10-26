import { addDays } from './calendar-layout';

/** The fields the dashboard counts — a work item, as far as it is concerned. */
export interface CountableItem {
  sectionId: string | null;
  parentId: string | null;
  createdAt: string;
  completedAt: string | null;
  /** A calendar date (`yyyy-mm-ddT00:00:00.000Z`) or null. */
  dueDate: string | null;
  assignees: { id: string; name: string }[];
}

export interface BarDatum {
  id: string;
  label: string;
  value: number;
}

export interface BurnupPoint {
  /** The Monday the week starts on. */
  week: string;
  /** Items that existed by the end of the week. */
  total: number;
  /** Items completed by the end of the week. */
  completed: number;
}

export interface DashboardStats {
  total: number;
  completed: number;
  incomplete: number;
  overdue: number;
  bySection: BarDatum[];
  byAssignee: BarDatum[];
  burnup: BurnupPoint[];
}

/** The local calendar day of an instant, as a key. */
function dayOfInstant(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Everything the project Dashboard shows, from the one list of work items the
 * other tabs read.
 *
 * Subtasks are left out, as the List leaves them out of its rows: a task with
 * five subtasks is one piece of work on a dashboard, not six. Overdue means
 * unfinished with a due date before today — today itself is not late yet.
 */
export function computeDashboard(
  items: readonly CountableItem[],
  sections: readonly { id: string; name: string }[],
  today: string,
  weeks = 8,
): DashboardStats {
  const work = items.filter((item) => !item.parentId);
  const open = work.filter((item) => item.completedAt === null);

  const overdue = open.filter(
    (item) => item.dueDate !== null && item.dueDate.slice(0, 10) < today,
  ).length;

  // Incomplete by section, in the project's own section order.
  const sectionCounts = new Map<string, number>();
  for (const item of open) {
    const key = item.sectionId ?? '';
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }
  const bySection: BarDatum[] = sections.map((section) => ({
    id: section.id,
    label: section.name,
    value: sectionCounts.get(section.id) ?? 0,
  }));
  const orphans = sectionCounts.get('') ?? 0;
  if (orphans > 0) bySection.push({ id: '', label: 'No section', value: orphans });

  // Incomplete by assignee, busiest first; the unassigned last whatever their count.
  const people = new Map<string, BarDatum>();
  let unassigned = 0;
  for (const item of open) {
    const person = item.assignees[0];
    if (!person) {
      unassigned += 1;
      continue;
    }
    const entry = people.get(person.id) ?? { id: person.id, label: person.name, value: 0 };
    entry.value += 1;
    people.set(person.id, entry);
  }
  const byAssignee = [...people.values()].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label),
  );
  if (unassigned > 0) byAssignee.push({ id: '', label: 'Unassigned', value: unassigned });

  // Burn-up: the last `weeks` Monday-first weeks, ending with this one.
  const todayDate = new Date(`${today}T12:00:00`);
  const thisMonday = addDays(today, -((todayDate.getDay() + 6) % 7));
  const created = work.map((item) => dayOfInstant(item.createdAt));
  const done = work.flatMap((item) => (item.completedAt ? [dayOfInstant(item.completedAt)] : []));

  const burnup: BurnupPoint[] = Array.from({ length: weeks }, (_, index) => {
    const week = addDays(thisMonday, (index - (weeks - 1)) * 7);
    const end = addDays(week, 6);
    return {
      week,
      total: created.filter((day) => day <= end).length,
      completed: done.filter((day) => day <= end).length,
    };
  });

  return {
    total: work.length,
    completed: work.length - open.length,
    incomplete: open.length,
    overdue,
    bySection,
    byAssignee,
    burnup,
  };
}
