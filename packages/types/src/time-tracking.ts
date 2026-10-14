import type { UpdateAuthor } from './project-updates.js';

/** One stretch of time logged against a task. */
export interface TimeEntry {
  id: string;
  taskId: string;
  minutes: number;
  /** The day the time was spent, `YYYY-MM-DD`. */
  date: string;
  note: string | null;
  user: UpdateAuthor | null;
  createdAt: string;
}

/** A task's logged time: its entries, newest day first, and their total. */
export interface TaskTime {
  entries: TimeEntry[];
  totalMinutes: number;
  estimatedMinutes: number | null;
}

export interface LogTimePayload {
  minutes: number;
  /** Today when left out. */
  date?: string;
  note?: string | null;
}
