import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { env } from '@/app/config/env';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WorkspaceSwitcher } from '@/features/workspaces/components/workspace-switcher';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';

import { SidebarNav } from './sidebar-nav';

/** Desktop sidebar. Collapses to an icon rail; the state is persisted. */
export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border/80 bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[72px]' : 'w-[17rem]',
      )}
    >
      <div
        className={cn('flex h-16 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}
      >
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label={`${env.appName} home`}
        >
          <BrandMark />
          {!collapsed && (
            <span className="text-[15px] font-semibold tracking-[-0.01em]">{env.appName}</span>
          )}
        </Link>
      </div>

      <div className={cn('px-3 pb-4', collapsed && 'px-2')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      {/*
        `min-h-0` alongside `flex-1`: a flex child defaults to `min-height:auto`,
        which refuses to shrink below its content, so on a short window the nav
        pushed the Collapse button past the bottom edge instead of scrolling.
      */}
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn('px-3 pb-4', collapsed && 'px-2')}>
          <SidebarNav collapsed={collapsed} />
        </div>
      </ScrollArea>

      <div className={cn('border-t p-2', collapsed && 'flex justify-center')}>
        <Button
          variant="ghost"
          size={collapsed ? 'icon-sm' : 'sm'}
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn(!collapsed && 'w-full justify-start text-muted-foreground')}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  );
}

/**
 * The CoreTask mark: a cut C round a green core with a check in it.
 *
 * Inline rather than an <img> so the shell paints in `currentColor` and follows
 * the theme — black on light, white on dark, which is exactly the logo's light
 * and dark versions — while the crescent and the core keep Core Green in both.
 *
 * The paths are the logo pack's mark, unaltered. It is taller than it is wide,
 * so it is sized by height and its width follows.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="9.54 9.5 89.96 148"
      aria-hidden="true"
      focusable="false"
      className={cn('h-8 w-auto shrink-0', className)}
    >
      <path
        fill="currentColor"
        d="M99 134.02L99 154.37A70 70 0 0 1 10.04 89.5L32.06 89.5A50 50 0 0 0 99 134.02Z"
      />
      <path
        fill="currentColor"
        d="M26.78 84.5L10.04 84.5A70 70 0 0 1 41.85 28.31A60 60 0 0 0 26.78 84.5Z"
      />
      <path
        fill="#00F006"
        d="M99 11.66L99 39.98A50 50 0 0 0 32.06 84.5L26.78 84.5A60 60 0 0 1 99 11.66Z"
      />
      <path
        fill="#00F006"
        d="M94 87A26 26 0 1 1 42 87A26 26 0 1 1 94 87ZM54.23 89.77L64.11 99.65L80.87 80.65L77.13 77.35L63.89 92.35L57.77 86.23Z"
      />
    </svg>
  );
}
