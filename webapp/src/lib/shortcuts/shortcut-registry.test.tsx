import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dispatchShortcut,
  resetShortcutRegistry,
  SHORTCUT_PRIORITY,
  useShortcutActions,
} from './shortcut-registry';

afterEach(() => resetShortcutRegistry());

describe('shortcut registry', () => {
  it('runs the most recent registration that offers the action', () => {
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() => useShortcutActions({ newTask: first }));
    renderHook(() => useShortcutActions({ newTask: second }));

    expect(dispatchShortcut('newTask')).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('falls through what a screen does not offer, and swallows what it owns but cannot do', () => {
    const list = vi.fn();
    renderHook(() => useShortcutActions({ newTask: list, archive: list }));
    renderHook(() => useShortcutActions({ archive: null }, { priority: SHORTCUT_PRIORITY.panel }));

    expect(dispatchShortcut('newTask')).toBe(true);
    expect(dispatchShortcut('archive')).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('lets a higher priority beat a later registration', () => {
    const panel = vi.fn();
    const list = vi.fn();
    renderHook(() => useShortcutActions({ assign: panel }, { priority: SHORTCUT_PRIORITY.panel }));
    renderHook(() => useShortcutActions({ assign: list }, { priority: SHORTCUT_PRIORITY.list }));

    dispatchShortcut('assign');

    expect(panel).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  it('forgets a screen once it unmounts or is disabled', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useShortcutActions({ comment: handler }));
    renderHook(() => useShortcutActions({ subtask: handler }, { enabled: false }));

    expect(dispatchShortcut('subtask')).toBe(false);

    unmount();
    expect(dispatchShortcut('comment')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('always calls the handler from the latest render', () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const { rerender } = renderHook(({ fn }) => useShortcutActions({ dueToday: fn }), {
      initialProps: { fn: stale },
    });
    rerender({ fn: fresh });

    dispatchShortcut('dueToday');

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});
