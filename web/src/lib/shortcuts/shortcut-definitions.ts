/**
 * Asana's keyboard shortcuts, as far as this app can honour them.
 *
 * The chords are Asana's own — hold Tab, press a letter — so anyone arriving
 * from there brings their muscle memory with them. One table drives both the
 * listener and the help sheet, so the sheet cannot promise a key the listener
 * does not know.
 */

export type ShortcutAction =
  | 'newTask'
  | 'assign'
  | 'assignToMe'
  | 'dueDate'
  | 'dueToday'
  | 'dueTomorrow'
  | 'comment'
  | 'subtask'
  | 'archive'
  | 'toggleComplete';

/** Tab + key → action. Keyed by `event.key`, lowercased. */
export const CHORD_ACTIONS: Readonly<Record<string, ShortcutAction>> = {
  n: 'newTask',
  a: 'assign',
  m: 'assignToMe',
  d: 'dueDate',
  y: 'dueToday',
  t: 'dueTomorrow',
  c: 'comment',
  s: 'subtask',
  backspace: 'archive',
};

/**
 * Resolved once at module load rather than in an effect: the platform cannot
 * change during a session, and a state update on mount would cost every screen
 * an extra render just to relabel one key hint.
 */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

export interface ShortcutEntry {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

/** What the help sheet lists, in the order Asana's does. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Tasks',
    items: [
      { keys: ['Tab', 'N'], description: 'New task' },
      { keys: ['Tab', 'A'], description: 'Assign' },
      { keys: ['Tab', 'M'], description: 'Assign to me' },
      { keys: ['Tab', 'D'], description: 'Set due date' },
      { keys: ['Tab', 'Y'], description: 'Due today' },
      { keys: ['Tab', 'T'], description: 'Due tomorrow' },
      { keys: ['Tab', 'C'], description: 'Comment' },
      { keys: ['Tab', 'S'], description: 'Add subtask' },
      { keys: ['Tab', 'Backspace'], description: 'Archive' },
      { keys: [MOD_KEY, 'Enter'], description: 'Mark complete or incomplete' },
    ],
  },
  {
    title: 'General',
    items: [
      { keys: ['Esc'], description: 'Clear the selection, close the task' },
      { keys: ['?'], description: 'Show these shortcuts' },
      { keys: [MOD_KEY, 'K'], description: 'Search (coming soon)' },
    ],
  },
];
