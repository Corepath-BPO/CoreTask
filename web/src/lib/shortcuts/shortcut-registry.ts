import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import type { ShortcutAction } from './shortcut-definitions';

/**
 * What a screen offers for each action.
 *
 * `undefined` means "not mine — ask whoever is beneath me"; `null` means "mine,
 * but not right now" and swallows the key, so an open task with nothing to
 * archive does not hand Tab+Backspace down to the list behind it.
 */
export type ShortcutHandlers = Partial<Record<ShortcutAction, (() => void) | null>>;

interface Registration {
  seq: number;
  priority: number;
  handlers: RefObject<ShortcutHandlers>;
}

/** The task panel sits over the list, so it answers first while it is open. */
export const SHORTCUT_PRIORITY = { list: 0, panel: 10 } as const;

const stack: Registration[] = [];
let sequence = 0;

function register(priority: number, handlers: RefObject<ShortcutHandlers>): () => void {
  const entry: Registration = { seq: sequence++, priority, handlers };
  stack.push(entry);
  return () => {
    const index = stack.indexOf(entry);
    if (index !== -1) stack.splice(index, 1);
  };
}

/**
 * Runs the topmost handler that speaks for the action.
 *
 * Returns whether anybody did — a caller can then say "open a project first"
 * rather than letting a chord fall silently on the floor.
 */
export function dispatchShortcut(action: ShortcutAction): boolean {
  const ordered = [...stack].sort((a, b) => b.priority - a.priority || b.seq - a.seq);

  for (const entry of ordered) {
    const handler = entry.handlers.current[action];
    if (handler === undefined) continue;
    handler?.();
    return true;
  }

  return false;
}

/**
 * Offers this screen's handlers for as long as it is mounted and enabled.
 *
 * The handlers live in a ref, so a re-render never re-registers and a stale
 * closure never fires; only `enabled` and `priority` touch the stack.
 */
export function useShortcutActions(
  handlers: ShortcutHandlers,
  options: { enabled?: boolean; priority?: number } = {},
): void {
  const { enabled = true, priority = SHORTCUT_PRIORITY.list } = options;
  const ref = useRef(handlers);

  useLayoutEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    return register(priority, ref);
  }, [enabled, priority]);
}

/** Tests only: forget every registration. */
export function resetShortcutRegistry(): void {
  stack.length = 0;
}
