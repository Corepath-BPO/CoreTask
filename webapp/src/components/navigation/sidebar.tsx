import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useId } from 'react';

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
 * The CoreTask mark: a green C flowing into a T, with a check circle inside.
 *
 * Inline rather than an <img> so one drawing serves both themes. The T's bar
 * blends from Core Green into navy in the light theme and into white in the
 * dark one — exactly the logo's light and dark versions. The paths are the
 * logo pack's, unaltered; the mark is wider than it is tall, so it is sized by
 * height and its width follows.
 *
 * The gradient's id comes from `useId`: the sidebar holding one copy is
 * `display: none` on small screens, and a gradient defined inside a hidden
 * element paints nothing for the copies that point at it.
 */
export function BrandMark({ className }: { className?: string }) {
  const blend = `brand-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg
      viewBox="77 110.5 273.5 192"
      aria-hidden="true"
      focusable="false"
      className={cn('h-7 w-auto shrink-0', className)}
    >
      <defs>
        <linearGradient id={blend} gradientUnits="userSpaceOnUse" x1="180" y1="0" x2="266" y2="0">
          <stop offset="0" stopColor="#71CD2C" />
          <stop offset="1" className="[stop-color:#03377B] dark:[stop-color:#FFFFFF]" />
        </linearGradient>
      </defs>
      <path
        fill="#71CD2C"
        d="M172 111L190 111L190 148L172 148A57.5 57.5 0 0 0 172 263L227.11 263A9 9 0 0 1 236 271.89L236 291.11A9 9 0 0 1 227.11 300L172 300A94.5 94.5 0 0 1 172 111Z"
      />
      <path
        fill={`url(#${blend})`}
        d="M265 148L172 148L172 111L343.09 111A7 7 0 0 1 350 117.91L350 141.09A7 7 0 0 1 343.09 148L300 148L300 295.09A7 7 0 0 1 293.09 302L271.91 302A7 7 0 0 1 265 295.09L265 148Z"
      />
      <path
        fill="#31A736"
        d="M241.5 206A45 45 0 1 1 151.5 206A45 45 0 1 1 241.5 206ZM186.68 225.46A5.5 5.5 0 0 0 194.46 225.32L221.59 196.17A5.5 5.5 0 0 0 213.54 188.68L190.36 213.58L180.32 203.54A5.5 5.5 0 0 0 172.54 211.32L186.68 225.46Z"
      />
      <path
        fill="#FFFFFF"
        d="M172.54 211.32A5.5 5.5 0 0 1 180.32 203.54L190.36 213.58L213.54 188.68A5.5 5.5 0 0 1 221.59 196.17L194.46 225.32A5.5 5.5 0 0 1 186.68 225.46L172.54 211.32Z"
      />
    </svg>
  );
}
