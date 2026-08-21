import { Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateWorkspaceDialog } from '@/features/workspaces/components/create-workspace-dialog';

import { MobileNav } from './mobile-nav';
import { NotificationMenu } from './notification-menu';
import { UserMenu } from './user-menu';

/**
 * Application top bar: mobile nav trigger, the search placeholder, create,
 * notifications, account menu.
 */
export function Topbar() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border/75 bg-background/88 px-3 backdrop-blur-xl sm:px-5">
      <MobileNav />

      {/*
        Search is not built. It used to look exactly like a working field and
        answer a click with a toast, which is the one thing the rest of this app
        does not do: unbuilt features say Soon. So it wears the dashed border
        this codebase already uses for a placeholder, says Soon, and does
        nothing when pressed.

        `aria-disabled` rather than `disabled`, so it stays reachable by keyboard
        and can still explain itself through the tooltip.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-disabled="true"
            className="flex h-10 flex-1 cursor-default items-center gap-2.5 rounded-lg border border-dashed bg-muted/40 px-3.5 text-sm text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none sm:max-w-lg"
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate text-left">Search tasks, tickets, projects</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>Search is not built yet</TooltipContent>
      </Tooltip>

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

        <NotificationMenu />

        <UserMenu />
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </header>
  );
}
