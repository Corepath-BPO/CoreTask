import { Link, useLocation } from '@tanstack/react-router';
import {
  CalendarRange,
  Gauge,
  LayoutDashboard,
  List,
  MessageSquare,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PortfolioTab {
  label: string;
  segment: string;
  icon: LucideIcon;
  /** Routed and honest about being unbuilt, rather than a fake working screen. */
  comingSoon?: boolean;
}

const TABS: PortfolioTab[] = [
  { label: 'List', segment: 'list', icon: List },
  { label: 'Timeline', segment: 'timeline', icon: CalendarRange },
  { label: 'Dashboard', segment: 'dashboard', icon: LayoutDashboard, comingSoon: true },
  { label: 'Progress', segment: 'progress', icon: TrendingUp, comingSoon: true },
  { label: 'Workload', segment: 'workload', icon: Gauge, comingSoon: true },
  { label: 'Messages', segment: 'messages', icon: MessageSquare, comingSoon: true },
];

/**
 * Which representation of the portfolio is on screen. Links rather than local
 * state, for the same reason as the project tabs: the choice survives refresh,
 * works with back and forward, and can be shared.
 */
export function PortfolioViewTabs({ portfolioId }: { portfolioId: string }) {
  const { pathname } = useLocation();

  return (
    <div
      role="tablist"
      aria-label="Portfolio views"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-px"
    >
      {TABS.map((tab) => {
        const to = `/portfolios/${portfolioId}/${tab.segment}`;
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
