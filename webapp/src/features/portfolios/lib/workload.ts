import { PortfolioWorkloadMeasure } from '@coretask/contracts';
import type { PortfolioWorkload, Task, UserRef } from '@coretask/types';

/** One person's share of the open work across a portfolio's projects. */
export interface WorkloadRow {
  /** Null for the work nobody is assigned. */
  person: Pick<UserRef, 'id' | 'name' | 'avatarUrl'> | null;
  open: number;
  overdue: number;
  /** Due from today through the next seven days. */
  dueThisWeek: number;
  /** Summed estimates, in minutes, of the open tasks that have one. */
  estimatedMinutes: number;
}

const DAY_MS = 86_400_000;

/** The calendar day a date-only column names, as UTC midnight milliseconds. */
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Today, as a calendar day in the reader's own zone. */
const todayOf = (now: Date) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

/**
 * Open work grouped by assignee — Asana's portfolio Workload, as counts.
 *
 * Only open tasks count: a completed one is nobody's load. Overdue is a due
 * day before today; "this week" is today and the six after it. People are
 * ordered by how much they carry, with the unassigned pile last because it
 * is nobody's to compare.
 */
export function workloadByPerson(tasks: readonly Task[], now: Date): WorkloadRow[] {
  const today = todayOf(now);
  const rows = new Map<string, WorkloadRow>();

  for (const task of tasks) {
    if (task.completedAt !== null || task.archivedAt !== null) continue;

    const key = task.assigneeId ?? '';
    const row =
      rows.get(key) ??
      ({
        person: task.assignee
          ? { id: task.assignee.id, name: task.assignee.name, avatarUrl: task.assignee.avatarUrl }
          : null,
        open: 0,
        overdue: 0,
        dueThisWeek: 0,
        estimatedMinutes: 0,
      } satisfies WorkloadRow);

    row.open += 1;
    row.estimatedMinutes += task.estimatedMinutes ?? 0;

    if (task.dueDate) {
      const due = dayOf(task.dueDate);
      if (due < today) row.overdue += 1;
      else if (due < today + 7 * DAY_MS) row.dueThisWeek += 1;
    }

    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => {
    if ((a.person === null) !== (b.person === null)) return a.person === null ? 1 : -1;
    return b.open - a.open || (a.person?.name ?? '').localeCompare(b.person?.name ?? '');
  });
}

/** A row's load in the portfolio's measure: open tasks, or estimated hours to one decimal. */
export function loadOf(row: WorkloadRow, measure: PortfolioWorkloadMeasure): number {
  return measure === PortfolioWorkloadMeasure.HOURS
    ? Math.round((row.estimatedMinutes / 60) * 10) / 10
    : row.open;
}

/**
 * A person's capacity: their own where set, else the portfolio's default.
 * The unassigned pile has none — it is nobody's to be over.
 */
export function capacityOf(personId: string | null, workload: PortfolioWorkload): number | null {
  if (personId === null) return null;
  return (
    workload.capacities.find((entry) => entry.userId === personId)?.capacity ??
    workload.defaultCapacity
  );
}
