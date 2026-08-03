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
        'hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[68px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-14 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label={`${env.appName} home`}
        >
          <BrandMark />
          {!collapsed && <span className="text-sm font-semibold">{env.appName}</span>}
        </Link>
      </div>

      <div className={cn('px-3 pb-3', collapsed && 'px-2')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <ScrollArea className="flex-1">
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
 * The CoreTask mark, rendered as an app-icon tile.
 *
 * The artwork is dark navy on white with no alpha, so it needs a light backdrop
 * to stay legible — keeping the white tile in both themes reads as deliberate
 * (and matches how the icon appears on a home screen) rather than as a stray
 * white box on the dark sidebar.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo-mark-96.png"
      alt=""
      aria-hidden="true"
      width={28}
      height={28}
      className={cn(
        'size-7 shrink-0 rounded-lg bg-white object-contain ring-1 ring-black/5 dark:ring-white/10',
        className,
      )}
    />
  );
}
