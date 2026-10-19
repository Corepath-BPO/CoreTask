import type { CalendarFeed } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarSyncDialog } from './calendar-sync-dialog';

const create = vi.fn();
const reset = vi.fn();
const stop = vi.fn();
let feed: CalendarFeed | null;

vi.mock('../hooks/use-calendar-feed', () => ({
  useCalendarFeed: () => ({ data: feed, isLoading: false }),
  useCreateCalendarFeed: () => ({ mutate: create, isPending: false }),
  useResetCalendarFeed: () => ({ mutate: reset, isPending: false }),
  useStopCalendarFeed: () => ({ mutate: stop, isPending: false }),
}));

const renderDialog = () =>
  render(
    <CalendarSyncDialog
      workspaceId="ws-1"
      projectId={null}
      label="My Tasks"
      open
      onOpenChange={() => {}}
    />,
  );

beforeEach(() => {
  create.mockReset();
  reset.mockReset();
  stop.mockReset();
  feed = null;
});

describe('CalendarSyncDialog', () => {
  it('offers to make a link when there is none', async () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Sync My Tasks to your calendar' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Make a calendar link' }));
    expect(create).toHaveBeenCalled();
  });

  it('shows the link, and asks twice before resetting it', async () => {
    feed = {
      id: 'f-1',
      projectId: null,
      url: 'https://api.example.org/api/v1/calendar/abc.ics',
      lastFetchedAt: null,
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    renderDialog();

    expect(screen.getByLabelText('Calendar link')).toHaveValue(feed.url);
    expect(screen.getByRole('link', { name: 'open it directly' })).toHaveAttribute(
      'href',
      'webcal://api.example.org/api/v1/calendar/abc.ics',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('stops working');
    await userEvent.click(screen.getByRole('button', { name: 'Reset the link' }));
    expect(reset).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    expect(stop).toHaveBeenCalled();
  });
});
