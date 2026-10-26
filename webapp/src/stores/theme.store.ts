import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'coretask.theme';

/**
 * Theme preference. The initial class is applied by an inline script in
 * `index.html` so a dark-mode reload never flashes white; this store owns it
 * from mount onwards.
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggle: () => {
        const next: Theme = resolveTheme(get().theme) === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyTheme(next);
      },
    }),
    {
      name: STORAGE_KEY,
      // Store the bare string so the inline boot script can read it without
      // knowing about Zustand's persist envelope.
      storage: {
        getItem: (name) => {
          const value = localStorage.getItem(name);
          return value ? { state: { theme: value as Theme }, version: 0 } : null;
        },
        setItem: (name, value) => localStorage.setItem(name, value.state.theme),
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return prefersDark() ? 'dark' : 'light';
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

/** Reads the theme and keeps the `dark` class in sync with the OS setting. */
export function useTheme() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const toggle = useThemeStore((state) => state.toggle);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== 'system') return;

    // Only follow the OS while the preference is explicitly "system".
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system');
    media.addEventListener('change', listener);

    return () => media.removeEventListener('change', listener);
  }, [theme]);

  return { theme, resolvedTheme: resolveTheme(theme), setTheme, toggle };
}
