import { Link, useLocation } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ProjectTab {
  label: string;
  segment: string;
  /** Routed and honest about being unbuilt, rather than a fake working screen. */
  comingSoon?: boolean;
}

/** Bare labels, as Asana draws its project tabs — the words carry it. */
const TABS: ProjectTab[] = [
  { label: 'Overview', segment: 'overview' },
  { label: 'List', segment: 'list' },
  { label: 'Board', segment: 'board' },
  { label: 'Automations', segment: 'automations' },
  { label: 'Activity', segment: 'activity', comingSoon: true },
  { label: 'Settings', segment: 'settings', comingSoon: true },
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
            // Carry the open task panel and the Customize panel across views —
            // both belong to the project, not to one tab. Everything else (the
            // automations tab's ?sectionId, for instance) still resets, which
            // is what a tab switch means.
            search={(previous) => ({
              task: (previous as { task?: string }).task,
              customize: (previous as { customize?: boolean }).customize,
            })}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              isActive
                ? 'bg-primary/10 font-medium text-primary-strong'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
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
