/**
 * A private calendar link — Asana's "Sync to calendar". Calendar apps
 * subscribe to `url`; anyone holding it reads these tasks as its owner would.
 */
export interface CalendarFeed {
  id: string;
  /** Null: the owner's My Tasks. */
  projectId: string | null;
  url: string;
  /** When a calendar app last fetched it, roughly; null until one has. */
  lastFetchedAt: string | null;
  createdAt: string;
}

export interface CalendarFeedTarget {
  /** Left out, the caller's My Tasks. */
  projectId?: string | null;
}
