import { Bell, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateWorkspaceDialog } from '@/features/workspaces/components/create-workspace-dialog';
import { UNREAD_NOTIFICATIONS } from '@/lib/mock/dashboard.mock';

import { MobileNav } from './mobile-nav';
import { UserMenu } from './user-menu';

/**
 * Application top bar: mobile nav trigger, global search, create, notifications,
 * account menu.
 */
/**
 * Resolved once at module load rather than in an effect: the platform cannot
 * change during a session, and a state update on mount would cost every screen
 * an extra render just to relabel one key hint.
 */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function Topbar() {
  const [createOpen, setCreateOpen] = useState(false);

  // Global search is not implemented yet, but the shortcut is reserved so muscle
  // memory does not have to be relearned later.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toast('Global search is coming in the next phase');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-sm sm:px-4">
      <MobileNav />

      <button
        type="button"
        onClick={() => toast('Global search is coming in the next phase')}
        className="flex h-9 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none sm:max-w-md"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Search tasks, tickets, projects…</span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
          {IS_MAC ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus />
              <span className="hidden sm:inline">Create</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create a workspace</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => toast('Notification centre is coming in the next phase')}
              aria-label={`Notifications (${UNREAD_NOTIFICATIONS} unread)`}
            >
              <Bell />
              {UNREAD_NOTIFICATIONS > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -right-0.5 -top-0.5 size-4 justify-center rounded-full p-0 text-[10px] leading-none"
                >
                  {UNREAD_NOTIFICATIONS}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>

        <UserMenu />
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </header>
  );
}
