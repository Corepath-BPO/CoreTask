import { useEffect } from 'react';

/**
 * Calls back once typing has settled.
 *
 * `useEffect`, not `useMemo` — a memo does not run the cleanup it is handed, so
 * a debounce built on one leaks a timer per keystroke and fires every one of
 * them. That mistake has been made in this codebase before.
 *
 * Shared rather than redefined per feature: the List view's search and the field
 * picker's both debounce a text input into a query, and two copies would drift
 * on the delay.
 */
export function useDebouncedValue(value: string, onSettled: (value: string) => void, delay = 300) {
  useEffect(() => {
    const timer = setTimeout(() => onSettled(value.trim()), delay);
    return () => clearTimeout(timer);
    // `onSettled` is a `useState` setter, which React guarantees is stable —
    // including it would be honest but adds a dependency that never changes.
  }, [value, onSettled, delay]);
}
