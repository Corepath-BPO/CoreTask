import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function whose identity never changes but which always calls the latest
 * `callback`.
 *
 * For handlers handed to memoized rows: an arrow made afresh on every render
 * is a new prop each time, and every row would render again for a change that
 * touched one of them.
 */
export function useStableCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
