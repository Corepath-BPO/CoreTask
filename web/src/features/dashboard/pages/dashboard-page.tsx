import { HomeWidget } from '@coretask/contracts';
import { CircleCheckBig, FolderKanban, LayoutGrid, UsersRound } from 'lucide-react';
import { useState, type ComponentType } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { DashboardSkeleton } from '@/components/feedback/loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { HomeCustomizeSheet } from '../components/home-customize-sheet';
import {
  AssignedWidget,
  NotepadWidget,
  ProjectProgressWidget,
  RecentActivityWidget,
  RecentTicketsWidget,
  TaskOverviewWidget,
  TicketHealthWidget,
  UpcomingWidget,
  type HomeData,
} from '../components/home-widgets';
import { useDashboardData } from '../hooks/use-dashboard';
import {
  DEFAULT_HOME_LAYOUT,
  useHomeLayout,
  useResetHomeLayout,
  useUpdateHomeLayout,
} from '../hooks/use-home-layout';

/** How many of the three columns each widget takes on a wide screen. */
const SPAN: Record<HomeWidget, string> = {
  TASK_OVERVIEW: 'lg:col-span-3',
  TICKET_HEALTH: 'lg:col-span-3',
  ASSIGNED: 'lg:col-span-2',
  UPCOMING: 'lg:col-span-1',
  PROJECT_PROGRESS: 'lg:col-span-2',
  RECENT_ACTIVITY: 'lg:col-span-1',
  RECENT_TICKETS: 'lg:col-span-3',
  NOTEPAD: 'lg:col-span-1',
};

/** The widgets that only read the page's data; the notepad has its own wiring. */
const DATA_WIDGETS: Record<Exclude<HomeWidget, 'NOTEPAD'>, ComponentType<{ data: HomeData }>> = {
  TASK_OVERVIEW: TaskOverviewWidget,
  TICKET_HEALTH: TicketHealthWidget,
  ASSIGNED: AssignedWidget,
  UPCOMING: UpcomingWidget,
  PROJECT_PROGRESS: ProjectProgressWidget,
  RECENT_ACTIVITY: RecentActivityWidget,
  RECENT_TICKETS: RecentTicketsWidget,
};

/**
 * Home — Asana's customizable Home page.
 *
 * The greeting, then the widgets each person chose, in their order: the
 * workspace's numbers, their own work, the team's movement, and a private
 * notepad if they want one. "Customize" opens the list of widgets; the layout
 * is theirs alone and follows them to any browser.
 */
export function DashboardPage() {
  const user = useCurrentUser();
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const data = useDashboardData(workspace?.id);
  const layoutQuery = useHomeLayout(workspace?.id);
  const update = useUpdateHomeLayout(workspace?.id);
  const reset = useResetHomeLayout(workspace?.id);
  const [customizing, setCustomizing] = useState(false);

  if (workspaceLoading || data.isLoading) return <DashboardSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No workspace yet"
        description="Create a workspace to start tracking tasks, tickets and projects with your team."
        className="mt-10"
      />
    );
  }

  const layout = layoutQuery.data ?? DEFAULT_HOME_LAYOUT;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <PageHeader
        title={`${greeting()}, ${user?.name.split(' ')[0] ?? 'there'}`}
        description={`Here is what is happening in ${workspace.name} today.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-8 gap-2 rounded-lg bg-background/45 px-3">
              <UsersRound className="size-3.5 text-primary-strong" aria-hidden="true" />
              {workspace.memberCount} members
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setCustomizing(true)}>
              <LayoutGrid />
              Customize
            </Button>
          </div>
        }
      />

      {layout.widgets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Your Home is empty"
          description="Add widgets to see your work, your team's progress and a private notepad here."
          action={
            <Button size="sm" onClick={() => setCustomizing(true)}>
              Add widgets
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-flow-row-dense lg:grid-cols-3">
          {layout.widgets.map((widget) => (
            <div key={widget} className={cn('min-w-0', SPAN[widget])}>
              {widget === HomeWidget.NOTEPAD ? (
                <NotepadWidget
                  key={layoutQuery.isSuccess ? 'loaded' : 'loading'}
                  notepad={layout.notepad}
                  onSave={(notepad) => update.mutate({ notepad })}
                />
              ) : (
                (() => {
                  const Widget = DATA_WIDGETS[widget];
                  return <Widget data={data} />;
                })()
              )}
            </div>
          ))}
        </div>
      )}

      <Separator />

      <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
        <CircleCheckBig className="size-3.5" aria-hidden="true" />
        Workspace <span className="font-mono">{workspace.slug}</span> · ticket prefix{' '}
        <span className="font-mono">{workspace.ticketPrefix}</span>
      </div>

      <HomeCustomizeSheet
        open={customizing}
        onOpenChange={setCustomizing}
        widgets={layout.widgets}
        onChange={(widgets) => update.mutate({ widgets })}
        onReset={() => reset.mutate()}
      />
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
