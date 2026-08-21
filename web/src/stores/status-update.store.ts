import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Asana-style project status updates ("On track", "At risk", …), set by a
 * person rather than derived from the work. Client-only, like portfolios:
 * there is no status-update API, so the latest status lives in this browser.
 * Keyed by project id alone — ids are uuids, so they cannot collide across
 * workspaces.
 */
export type ProjectStatusUpdateValue =
  'on_track' | 'at_risk' | 'off_track' | 'on_hold' | 'complete' | 'dropped';

export interface ProjectStatusUpdate {
  status: ProjectStatusUpdateValue;
  /** The composer's editable heading, e.g. "Platform — Aug 18". */
  title: string | null;
  /** The "Summary" section. */
  note: string | null;
  /** The "Next steps" section. */
  nextSteps: string | null;
  updatedAt: string;
}

export interface StatusUpdateDetails {
  title?: string | null;
  note?: string | null;
  nextSteps?: string | null;
}

interface StatusUpdateState {
  byProject: Record<string, ProjectStatusUpdate>;
  setStatus: (
    projectId: string,
    status: ProjectStatusUpdateValue,
    details?: StatusUpdateDetails,
  ) => void;
}

export const useStatusUpdateStore = create<StatusUpdateState>()(
  persist(
    (set) => ({
      byProject: {},

      setStatus: (projectId, status, details) =>
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: {
              status,
              title: details?.title ?? null,
              note: details?.note ?? null,
              nextSteps: details?.nextSteps ?? null,
              updatedAt: new Date().toISOString(),
            },
          },
        })),
    }),
    { name: 'coretask.project-status-updates' },
  ),
);

export const useProjectStatusUpdate = (projectId: string): ProjectStatusUpdate | null =>
  useStatusUpdateStore((state) => state.byProject[projectId] ?? null);
