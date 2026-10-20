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
 * The CoreTask mark.
 *
 * Inline rather than an <img> so the artwork paints in `currentColor`: the mark
 * is monochrome, so it rides the surrounding text colour across a theme switch
 * instead of needing a second asset — and with no fixed ink it no longer needs
 * the white tile the old navy-on-white artwork was mounted on.
 *
 * The geometry is the brand mark at its native 64-unit grid; the 8-unit inset
 * is the lockup's own padding, so it stays optically centred at any size.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('size-8 shrink-0', className)}
    >
      <g fill="none" stroke="currentColor" strokeWidth={4}>
        <rect x="8" y="8" width="18" height="18" />
        <rect x="38" y="8" width="18" height="18" />
        <rect x="8" y="38" width="18" height="18" />
      </g>
      <rect x="36" y="36" width="22" height="22" fill="currentColor" />
    </svg>
  );
}
