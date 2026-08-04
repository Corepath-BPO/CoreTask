import type { NotificationEntry } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent, waitFor, within } from '@/test/test-utils';

import { InboxPage } from './inbox-page';

const markRead = vi.fn();
const markUnread = vi.fn();
const fetchNextPage = vi.fn();

let pages: { items: NotificationEntry[]; unreadCount: number; nextCursor: string | null }[] = [];
let hasNextPage = false;
let isLoading = false;

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Acme' }, isLoading: false }),
}));

vi.mock('@/features/activity/hooks/use-activity', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useInbox: () => ({
      data: { pages },
      isLoading,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage: false,
    }),
    useMarkNotificationsRead: () => ({ mutate: markRead, isPending: false }),
    useMarkNotificationUnread: () => ({ mutate: markUnread, isPending: false }),
  };
});

const entry = (overrides: Partial<NotificationEntry> = {}): NotificationEntry => ({
  id: 'n-1',
  userId: 'u-1',
  workspaceId: 'ws-1',
  type: 'MENTIONED',
  title: 'Ada mentioned you',
  body: 'Could you take a look?',
  entity: 'COMMENT',
  entityId: 'c-1',
  actionUrl: '/my-tasks',
  readAt: null,
  createdAt: new Date('2026-08-04T12:00:00Z').toISOString(),
  ...overrides,
});

const render = () => renderWithRouter(InboxPage, { initialPath: '/inbox' });

describe('InboxPage', () => {
  beforeEach(() => {
    markRead.mockReset();
    markUnread.mockReset();
    fetchNextPage.mockReset();
    hasNextPage = false;
    isLoading = false;
    pages = [{ items: [entry()], unreadCount: 1, nextCursor: null }];
  });

  it('lists what is in the inbox', async () => {
    await render();

    expect(await screen.findByText('Ada mentioned you')).toBeInTheDocument();
    expect(screen.getByText('Could you take a look?')).toBeInTheDocument();
  });

  it('shows an empty state rather than a blank page', async () => {
    pages = [{ items: [], unreadCount: 0, nextCursor: null }];
    await render();

    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('marks one as read', async () => {
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: /^mark ".*" read$/i }));

    expect(markRead).toHaveBeenCalledWith(['n-1']);
  });

  /*
   * `undefined` rather than an empty array: the API treats "no ids" as "clear
   * the whole inbox", and an empty array would be a request to mark nothing.
   */
  it('clears the whole inbox with no ids at all', async () => {
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: /^mark all read$/i }));

    expect(markRead).toHaveBeenCalledWith(undefined);
  });

  it('offers to undo a read entry rather than only to read it', async () => {
    pages = [{ items: [entry({ readAt: new Date().toISOString() })], unreadCount: 0, nextCursor: null }];
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: /^mark ".*" unread$/i }));

    expect(markUnread).toHaveBeenCalledWith('n-1');
  });

  it('hides "mark all read" when nothing is unread', async () => {
    pages = [{ items: [entry({ readAt: new Date().toISOString() })], unreadCount: 0, nextCursor: null }];
    await render();

    await waitFor(() => expect(screen.getByText('Ada mentioned you')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^mark all read$/i })).not.toBeInTheDocument();
  });

  it('reads the badge from the server count, not the page length', async () => {
    // One item on screen, forty unread in the workspace.
    pages = [{ items: [entry()], unreadCount: 40, nextCursor: 'c1' }];
    await render();

    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getByText('40')).toBeInTheDocument();
  });

  it('opening an unread entry marks it read', async () => {
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: /^open "Ada mentioned you"$/i }));

    expect(markRead).toHaveBeenCalledWith(['n-1']);
  });

  it('does not re-mark an entry that is already read', async () => {
    pages = [{ items: [entry({ readAt: new Date().toISOString() })], unreadCount: 0, nextCursor: null }];
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: /^open "Ada mentioned you"$/i }));

    expect(markRead).not.toHaveBeenCalled();
  });

  it('loads the next page on request', async () => {
    hasNextPage = true;
    const user = userEvent.setup();
    await render();

    await user.click(await screen.findByRole('button', { name: /load more/i }));

    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('offers no "load more" when there is nothing more', async () => {
    await render();

    await waitFor(() => expect(screen.getByText('Ada mentioned you')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('flattens every loaded page into one list', async () => {
    pages = [
      { items: [entry()], unreadCount: 2, nextCursor: 'c1' },
      { items: [entry({ id: 'n-2', title: 'Second page item' })], unreadCount: 2, nextCursor: null },
    ];
    await render();

    expect(await screen.findByText('Ada mentioned you')).toBeInTheDocument();
    expect(screen.getByText('Second page item')).toBeInTheDocument();
  });
});
