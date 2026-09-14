import { Link, useLocation } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface IntegrationsTab {
  label: string;
  segment: string;
  /** Routed and honest about being unbuilt, rather than a fake working screen. */
  comingSoon?: boolean;
}

const TABS: IntegrationsTab[] = [
  { label: 'API keys', segment: 'api-keys' },
  { label: 'Webhooks', segment: 'webhooks' },
];

/** Links rather than local state, so the tab lives in the URL and survives a refresh. */
export function IntegrationsTabs() {
  const { pathname } = useLocation();

  return (
    <div
      role="tablist"
      aria-label="Integrations"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-px"
    >
      {TABS.map((tab) => {
        const to = `/integrations/${tab.segment}`;
        const isActive = pathname === to || pathname.startsWith(`${to}/`);

        return (
          <Link
            key={tab.segment}
            to={to}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              isActive
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
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
