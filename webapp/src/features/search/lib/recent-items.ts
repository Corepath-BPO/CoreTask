import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Something opened from search, remembered so the empty box can offer it again. */
export interface RecentItem {
  kind: 'task' | 'ticket' | 'project' | 'person';
  id: string;
  label: string;
  /** A line of context: the project a task is in, a person's e-mail. */
  detail: string | null;
  /** Where opening it goes. */
  href: string;
  color?: string | null;
}

const MAX_RECENTS = 8;

/**
 * Asana's "Recents", per workspace and per browser.
 *
 * A convenience, not a record: persisted so a reload keeps it, scoped by
 * workspace so switching tenants never offers the other one's work, and a
 * stale entry (since deleted) costs no more than a click onto a not-found.
 */
export const useRecentItems = create<{
  byWorkspace: Record<string, RecentItem[]>;
  remember: (workspaceId: string, item: RecentItem) => void;
  clear: (workspaceId: string) => void;
}>()(
  persist(
    (set) => ({
      byWorkspace: {},
      remember: (workspaceId, item) =>
        set((state) => {
          const current = state.byWorkspace[workspaceId] ?? [];
          const next = [
            item,
            ...current.filter((entry) => !(entry.kind === item.kind && entry.id === item.id)),
          ].slice(0, MAX_RECENTS);
          return { byWorkspace: { ...state.byWorkspace, [workspaceId]: next } };
        }),
      clear: (workspaceId) =>
        set((state) => ({ byWorkspace: { ...state.byWorkspace, [workspaceId]: [] } })),
    }),
    { name: 'coretask.recent-items' },
  ),
);
