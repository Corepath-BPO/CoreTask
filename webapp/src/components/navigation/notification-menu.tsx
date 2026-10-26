import { Bell } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMarkNotificationsRead, useNotifications } from '@/features/activity/hooks/use-activity';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatRelativeTime } from '@/lib/utils';

/** How many fit in the dropdown before it becomes a list worth its own page. */
const PREVIEW_LIMIT = 8;

export function NotificationMenu() {
  const { workspace } = useActiveWorkspace();
  const { data } = useNotifications(workspace?.id, PREVIEW_LIMIT);
  const markRead = useMarkNotificationsRead(workspace?.id);

  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        >
          <Bell />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-0.5 -top-0.5 size-4 justify-center rounded-full p-0 text-[10px] leading-none"
            >
              {/* Two digits is all that fits; beyond that the exact count stops
                  mattering and only "a lot" does. */}
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-xs font-normal"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(undefined)}
            >
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          items.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="flex-col items-start gap-0.5 whitespace-normal"
              onSelect={() => {
                if (!notification.readAt) markRead.mutate([notification.id]);
              }}
            >
              <span className={cn('text-sm leading-snug', !notification.readAt && 'font-medium')}>
                {notification.title}
              </span>
              {notification.body && (
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {notification.body}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {formatRelativeTime(notification.createdAt)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
