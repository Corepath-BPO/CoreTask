import { Link, useLocation } from '@tanstack/react-router';
import {
  Activity,
  LayoutDashboard,
  List,
  Settings,
  SquareKanban,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ProjectTab {
  label: string;
  segment: string;
  icon: LucideIcon;
  /** Routed and honest about being unbuilt, rather than a fake working screen. */
  comingSoon?: boolean;
}

const TABS: ProjectTab[] = [
  { label: 'Overview', segment: 'overview', icon: LayoutDashboard },
  { label: 'List', segment: 'list', icon: List },
  { label: 'Board', segment: 'board', icon: SquareKanban },
  { label: 'Automations', segment: 'automations', icon: Zap },
  { label: 'Activity', segment: 'activity', icon: Activity, comingSoon: true },
  { label: 'Settings', segment: 'settings', icon: Settings, comingSoon: true },
];

/**
 * Which representation of the project is on screen.
 *
 * Links rather than buttons over local state, so the choice lives in the URL:
 * it survives a refresh, works with back and forward, and can be pasted to a
 * colleague. A project is not a board — the board is one of these.
 */
export function ProjectViewTabs({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();

  return (
    <div
      role="tablist"
      aria-label="Project views"
      // Scrolls rather than wraps on a narrow screen: a wrapped tab row pushes
      // the content down unpredictably as the label lengths change.
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-px"
    >
      {TABS.map((tab) => {
        const to = `/projects/${projectId}/${tab.segment}`;
        const isActive = pathname === to || pathname.startsWith(`${to}/`);

        return (
          <Link
            key={tab.segment}
            to={to}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <tab.icon className="size-4" aria-hidden="true" />
            {tab.label}
            {tab.comingSoon && (
              // Named as well as styled: "Soon" has to be readable, not merely
              // a dimmer shade of the other tabs.
              <Badge variant="muted" className="ml-0.5 text-[10px]">
                Soon
              </Badge>
            )}
          </Link>
        );
      })}
    </div>
  );
}
