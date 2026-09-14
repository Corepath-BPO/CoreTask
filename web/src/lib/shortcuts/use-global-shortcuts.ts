import { useEffect } from 'react';
import { toast } from 'sonner';

import { useUiStore } from '@/stores/ui.store';

import { CHORD_ACTIONS } from './shortcut-definitions';
import { dispatchShortcut } from './shortcut-registry';

const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]';

/** Whether a key pressed here is being typed, not commanded. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/** A Tab with no keyup — alt-tabbing away mid-chord — stops arming after this. */
const TAB_HOLD_MS = 1500;

/**
 * The one keyboard listener, mounted by the app shell.
 *
 * Tab is never `preventDefault`ed: it still moves focus, so keyboard navigation
 * keeps working for everyone who is not chording. What the listener tracks is
 * whether Tab is *held* — keydown arms, keyup disarms — and a letter that lands
 * while it is held, outside a field, is a chord. The letter is the key that
 * gets swallowed, not the Tab.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    let tabHeld = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const release = () => {
      tabHeld = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // An IME composing a character sends keys that are not commands.
      if (event.isComposing || event.keyCode === 229) return;

      if (event.key === 'Tab') {
        // A Radix menu or select that trapped Tab has already answered it.
        if (event.repeat || event.defaultPrevented) return;
        tabHeld = true;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(release, TAB_HOLD_MS);
        return;
      }

      if (event.defaultPrevented) return;
      const editable = isEditableTarget(event.target);

      if (tabHeld && !event.ctrlKey && !event.metaKey && !event.altKey && !editable) {
        const action = CHORD_ACTIONS[event.key.toLowerCase()];
        if (action) {
          event.preventDefault();
          if (!dispatchShortcut(action) && action === 'newTask') {
            toast('Open a project to create a task');
          }
          return;
        }
      }

      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !editable) {
        if (dispatchShortcut('toggleComplete')) event.preventDefault();
        return;
      }

      if (event.key === '?' && !editable && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        useUiStore.getState().setShortcutsHelpOpen(true);
        return;
      }

      // Global search is not implemented yet, but the shortcut is reserved so
      // muscle memory does not have to be relearned later.
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toast('Global search is coming in the next phase');
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Tab') release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);

    return () => {
      release();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }, []);
}
