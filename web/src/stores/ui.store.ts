import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  /** Desktop sidebar collapsed to icons. Persisted — it is a layout preference. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** Mobile drawer. Deliberately not persisted; it should never open on load. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /** The keyboard shortcut sheet. Opened by `?` and the account menu. */
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean) => void;

  /**
   * The task panel's feed: stories interleaved with comments, or comments
   * alone. Persisted — Asana remembers the choice, and so should we.
   */
  activityFeedMode: 'all' | 'comments';
  setActivityFeedMode: (mode: 'all' | 'comments') => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

      shortcutsHelpOpen: false,
      setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),

      activityFeedMode: 'all',
      setActivityFeedMode: (activityFeedMode) => set({ activityFeedMode }),
    }),
    {
      name: 'coretask.ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        activityFeedMode: state.activityFeedMode,
      }),
    },
  ),
);
