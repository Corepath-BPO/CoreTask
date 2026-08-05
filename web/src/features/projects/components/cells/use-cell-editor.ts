import { useRef, useState } from 'react';

/**
 * The interaction contract every editable cell follows.
 *
 * One place, so a date cell and a number cell cannot disagree about what Escape
 * does. Enter commits, Escape reverts, and blurring commits — the last is the
 * behaviour people expect from a spreadsheet, where clicking away is a decision
 * rather than an abandonment.
 *
 * Reverting on Escape restores the value the cell opened with, not the last
 * keystroke: a half-typed edit that gets cancelled must leave nothing behind.
 */
export function useCellEditor<T>(
  initial: T,
  onCommit: (value: T) => void,
): {
  editing: boolean;
  draft: T;
  setDraft: (value: T) => void;
  open: () => void;
  commit: () => void;
  cancel: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
} {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(initial);
  // What the cell opened with, so Escape has something true to return to.
  const opened = useRef<T>(initial);

  /*
   * No effect syncing `initial` into `draft`.
   *
   * `draft` is only ever read while editing, and `open()` seeds it from
   * `initial` at that moment — so a value changed elsewhere by an automation or
   * another person is picked up the next time the cell opens, without a
   * cascading render, and without any risk of overwriting a live edit.
   */
  const open = () => {
    opened.current = initial;
    setDraft(initial);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== opened.current) onCommit(draft);
  };

  const cancel = () => {
    setDraft(opened.current);
    setEditing(false);
  };

  return {
    editing,
    draft,
    setDraft,
    open,
    commit,
    cancel,
    onKeyDown: (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // Stops the surrounding dialog or popover closing as well: the reader
        // meant to cancel the cell, not leave the screen.
        event.stopPropagation();
        cancel();
      }
    },
  };
}
