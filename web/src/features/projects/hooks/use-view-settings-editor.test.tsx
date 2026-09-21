import type { ProjectView } from '@coretask/types';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '@/lib/api/query-client';

const update = vi.fn();

vi.mock('../api/project-views.api', () => ({
  projectViewsApi: { update: (...args: unknown[]) => update(...args) },
  customFieldsApi: {},
}));

import { DEFAULT_VIEW_SETTINGS } from '../lib/view-settings';

import { canPersistView, useViewSettingsEditor } from './use-project-views';

const view: ProjectView = {
  id: 'v-1',
  projectId: 'p-1',
  name: 'List',
  type: 'LIST',
  scope: 'PROJECT',
  ownerUserId: null,
  isDefault: true,
  isFavorite: false,
  position: 1,
  settings: DEFAULT_VIEW_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useViewSettingsEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    update.mockReset();
    update.mockImplementation((_ws, _p, _id, payload) =>
      Promise.resolve({ ...view, settings: { ...view.settings, ...payload.settings } }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a change at once and writes it once the changes pause', async () => {
    const { result } = renderHook(
      () =>
        useViewSettingsEditor({ workspaceId: 'ws-1', projectId: 'p-1', view, canPersist: true }),
      { wrapper },
    );

    act(() => result.current.update({ showCompleted: false }));
    act(() => result.current.update({ density: 'COMPACT' }));

    // The draft drives the query immediately; nothing has been sent yet.
    expect(result.current.settings.showCompleted).toBe(false);
    expect(result.current.settings.density).toBe('COMPACT');
    expect(update).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // One PATCH carrying both changes, not one per click.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[3]).toEqual({
      settings: { ...DEFAULT_VIEW_SETTINGS, showCompleted: false, density: 'COMPACT' },
    });
  });

  it('keeps the draft and never writes when this person may not', async () => {
    const { result } = renderHook(
      () =>
        useViewSettingsEditor({ workspaceId: 'ws-1', projectId: 'p-1', view, canPersist: false }),
      { wrapper },
    );

    act(() => result.current.update({ showCompleted: false }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(update).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
    expect(result.current.settings.showCompleted).toBe(false);
  });

  it('reverts to what the server holds when the write fails', async () => {
    update.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(
      () =>
        useViewSettingsEditor({ workspaceId: 'ws-1', projectId: 'p-1', view, canPersist: true }),
      { wrapper },
    );

    act(() => result.current.update({ showCompleted: false }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.settings.showCompleted).toBe(true);
    expect(result.current.dirty).toBe(false);
  });
});

describe('canPersistView', () => {
  it('mirrors the API: owners on personal views, members on shared ones', () => {
    expect(canPersistView(view, 'u-1', 'GUEST')).toBe(false);
    expect(canPersistView(view, 'u-1', 'MEMBER')).toBe(true);

    const personal: ProjectView = { ...view, scope: 'PERSONAL', ownerUserId: 'u-1' };
    expect(canPersistView(personal, 'u-1', 'GUEST')).toBe(true);
    expect(canPersistView(personal, 'u-2', 'MANAGER')).toBe(false);
    expect(canPersistView(undefined, 'u-1', 'MANAGER')).toBe(false);
  });
});
