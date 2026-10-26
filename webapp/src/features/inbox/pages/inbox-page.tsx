import { NotificationType } from '@coretask/contracts';
import type { NotificationEntry } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  AtSign,
  Bell,
  Bookmark,
  CalendarClock,
  CheckCheck,
  Inbox as InboxIcon,
  MessageSquare,
  RotateCcw,
  SlidersHorizontal,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useArchiveNotifications,
  useBookmarkNotification,
  useInbox,
  useMarkNotificationUnread,
  useMarkNotificationsRead,
  useUnarchiveNotification,
  type InboxFilter,
} from '@/features/activity/hooks/use-activity';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatRelativeTime } from '@/lib/utils';

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mentions', label: 'Mentions' },
  { value: 'bookmarked', label: 'Bookmarks' },
  { value: 'archived', label: 'Archive' },
];

export function InboxPage() {
  const { workspace } = useActiveWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InboxFilter>('all');

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInbox(
    workspace?.id,
    filter,
  );
  const markRead = useMarkNotificationsRead(workspace?.id);
  const markUnread = useMarkNotificationUnread(workspace?.id);
  const archive = useArchiveNotifications(workspace?.id);
  const unarchive = useUnarchiveNotification(workspace?.id);
  const bookmark = useBookmarkNotification(workspace?.id);
  const inArchive = filter === 'archived';

  const pages = data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  // Read from the first page: the server counts the whole workspace, so any
  // page carries the same total and the newest one is the freshest.
  const unreadCount = pages[0]?.unreadCount ?? 0;

  const open = (entry: NotificationEntry) => {
    // Opening something is reading it. Doing this before navigating means the
    // badge is already right when the destination renders.
    if (!entry.readAt) markRead.mutate([entry.id]);
    if (entry.actionUrl) void navigate({ to: entry.actionUrl });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Mentions, assignments and replies to things you are part of."
        actions={
          <div className="flex flex-wrap gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                onClick={() => markRead.mutate(undefined)}
                loading={markRead.isPending}
              >
                <CheckCheck className="size-4" aria-hidden="true" />
                Mark all read
              </Button>
            )}
            {/* Asana's inbox zero: everything filed away in one go. */}
            {filter === 'all' && items.length > 0 && (
              <Button
                variant="outline"
                onClick={() => archive.mutate(undefined)}
                loading={archive.isPending}
              >
                <Archive className="size-4" aria-hidden="true" />
                Archive all
              </Button>
            )}
          </div>
        }
      />

      <div role="tablist" aria-label="Filter notifications" className="flex gap-1">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            role="tab"
            aria-selected={filter === option.value}
            variant={filter === option.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(option.value)}
          >
            {option.label}
            {option.value === 'unread' && unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1.5">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={
            filter === 'all'
              ? 'Nothing here yet'
              : filter === 'archived'
                ? 'Nothing archived'
                : filter === 'bookmarked'
                  ? 'No bookmarks'
                  : 'Nothing matching that filter'
          }
          description={
            filter === 'all'
              ? 'When someone mentions you, assigns you work or replies to a thread you are part of, it lands here.'
              : filter === 'archived'
                ? 'Archive notifications you are done with, and they wait here instead of crowding the inbox.'
                : filter === 'bookmarked'
                  ? 'Bookmark a notification to keep it at hand, archived or not.'
                  : 'Try a different filter to see the rest of your inbox.'
          }
        />
      ) : (
        <>
          <ul aria-label="Notifications" className="space-y-2">
            {items.map((entry) => (
              <li key={entry.id}>
                <article
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 transition-colors',
                    entry.readAt ? 'border-border bg-card' : 'border-primary/30 bg-primary/[0.03]',
                  )}
                >
                  <NotificationIcon type={entry.type} />

                  <button
                    type="button"
                    onClick={() => open(entry)}
                    // Labelled explicitly because the visible content is a
                    // title, a body excerpt and a timestamp; without this the
                    // accessible name is all three run together.
                    aria-label={`Open "${entry.title}"`}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className={cn('text-sm text-foreground', !entry.readAt && 'font-medium')}>
                      {entry.title}
                    </p>
                    {entry.body && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {entry.body}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatRelativeTime(entry.createdAt)}
                    </p>
                  </button>

                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-pressed={Boolean(entry.bookmarkedAt)}
                      aria-label={
                        entry.bookmarkedAt
                          ? `Remove the bookmark on "${entry.title}"`
                          : `Bookmark "${entry.title}"`
                      }
                      onClick={() =>
                        bookmark.mutate({
                          notificationId: entry.id,
                          bookmarked: !entry.bookmarkedAt,
                        })
                      }
                    >
                      <Bookmark
                        className={cn(
                          'size-4',
                          entry.bookmarkedAt && 'fill-current text-primary-strong',
                        )}
                        aria-hidden="true"
                      />
                    </Button>

                    {!inArchive &&
                      (entry.readAt ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Mark "${entry.title}" unread`}
                          onClick={() => markUnread.mutate(entry.id)}
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Mark "${entry.title}" read`}
                          onClick={() => markRead.mutate([entry.id])}
                        >
                          <CheckCheck className="size-4" aria-hidden="true" />
                        </Button>
                      ))}

                    {entry.archivedAt ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move "${entry.title}" back to the inbox`}
                        onClick={() => unarchive.mutate(entry.id)}
                      >
                        <ArchiveRestore className="size-4" aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Archive "${entry.title}"`}
                        onClick={() => archive.mutate([entry.id])}
                      >
                        <Archive className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>

          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void fetchNextPage()}
                loading={isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NotificationIcon({ type }: { type: NotificationType }) {
  const Icon =
    type === NotificationType.MENTIONED
      ? AtSign
      : type === NotificationType.COMMENT_CREATED
        ? MessageSquare
        : type === NotificationType.WORKSPACE_INVITE
          ? UserPlus
          : type === NotificationType.TASK_STATUS_CHANGED ||
              type === NotificationType.TICKET_STATUS_CHANGED
            ? CheckCheck
            : type === NotificationType.TASK_UPDATED || type === NotificationType.TICKET_UPDATED
              ? CalendarClock
              : type === NotificationType.FIELD_CHANGED
                ? SlidersHorizontal
                : Bell;

  return (
    <span className="mt-0.5 rounded-md bg-muted p-1.5">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}
