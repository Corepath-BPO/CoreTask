import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShortcutsHelpDialog } from '@/components/navigation/shortcuts-help-dialog';
import { useUiStore } from '@/stores/ui.store';

import {
  resetShortcutRegistry,
  useShortcutActions,
  type ShortcutHandlers,
} from './shortcut-registry';
import { useGlobalShortcuts } from './use-global-shortcuts';

function Harness({ handlers }: { handlers: ShortcutHandlers }) {
  useGlobalShortcuts();
  useShortcutActions(handlers);
  return <textarea aria-label="Notes" />;
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    resetShortcutRegistry();
    useUiStore.setState({ shortcutsHelpOpen: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a chord while Tab is held, and swallows the letter', () => {
    const newTask = vi.fn();
    render(<Harness handlers={{ newTask }} />);

    fireEvent.keyDown(window, { key: 'Tab' });
    const letterWentThrough = fireEvent.keyDown(window, { key: 'n' });

    expect(newTask).toHaveBeenCalledTimes(1);
    expect(letterWentThrough).toBe(false);
  });

  it('does nothing for a bare letter, or once Tab is released', () => {
    const newTask = vi.fn();
    render(<Harness handlers={{ newTask }} />);

    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key: 'Tab' });
    fireEvent.keyUp(window, { key: 'Tab' });
    fireEvent.keyDown(window, { key: 'n' });

    expect(newTask).not.toHaveBeenCalled();
  });

  it('leaves letters typed into a field alone', () => {
    const newTask = vi.fn();
    render(<Harness handlers={{ newTask }} />);

    fireEvent.keyDown(window, { key: 'Tab' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'n' });

    expect(newTask).not.toHaveBeenCalled();
  });

  it('stops arming when a Tab never gets its keyup', () => {
    vi.useFakeTimers();
    const newTask = vi.fn();
    render(<Harness handlers={{ newTask }} />);

    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    fireEvent.keyDown(window, { key: 'n' });

    expect(newTask).not.toHaveBeenCalled();
  });

  it('marks complete on Ctrl+Enter', () => {
    const toggleComplete = vi.fn();
    render(<Harness handlers={{ toggleComplete }} />);

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    expect(toggleComplete).toHaveBeenCalledTimes(1);
  });

  it('opens the shortcut sheet on ?', () => {
    render(
      <>
        <Harness handlers={{}} />
        <ShortcutsHelpDialog />
      </>,
    );

    fireEvent.keyDown(window, { key: '?' });

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Assign to me')).toBeInTheDocument();
  });
});
