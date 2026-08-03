import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  /**
   * Last workspace the user looked at. A *preference*, not an authorisation —
   * the API re-checks membership on every request, so a stale or tampered value
   * can only ever produce a 403.
   */
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      setActiveWorkspaceId: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
    }),
    { name: 'coretask.workspace' },
  ),
);

export const useActiveWorkspaceId = () => useWorkspaceStore((state) => state.activeWorkspaceId);
