import { Activity, CalendarClock, CircleCheckBig, FolderKanban, Ticket } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/data-display/stat-card';
import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/components/data-display/status-badge';
import { EmptyState } from '@/components/feedback/empty-state';
import { DashboardSkeleton } from '@/components/feedback/loading';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import {
  ASSIGNED_TASKS,
  PROJECT_PROGRESS,
  RECENT_ACTIVITY,
  RECENT_TICKETS,
  TASK_SUMMARY,
  TICKET_SUMMARY,
  UPCOMING_DEADLINES,
} from '@/lib/mock/dashboard.mock';
import {
  cn,
  daysUntil,
  formatDueDate,
  formatRelativeTime,
  initials,
  percentage,
} from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

export function DashboardPage() {
  const user = useCurrentUser();
  const { workspace, isLoading } = useActiveWorkspace();

  if (isLoading) return <DashboardSkeleton />;

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${user?.name.split(' ')[0] ?? 'there'}`}
        description={`Here is what is happening in ${workspace.name} today.`}
        actions={
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            {workspace.memberCount} members
          </Badge>
        }
      />

      {/* Placeholder data notice — removed together with the mock module. */}
      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        Tasks, tickets, projects and activity below use sample content. Authentication and
        workspaces are live against the API.
      </div>

      <section aria-labelledby="tasks-heading" className="space-y-3">
        <h2 id="tasks-heading" className="text-sm font-semibold">
          Tasks
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TASK_SUMMARY.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              delta={stat.delta}
              hint={stat.hint}
              invertDelta={stat.label === 'Overdue'}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="tickets-heading" className="space-y-3">
        <h2 id="tickets-heading" className="text-sm font-semibold">
          Tickets
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TICKET_SUMMARY.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              delta={stat.delta}
              hint={stat.hint}
              invertDelta={stat.label === 'Urgent' || stat.label === 'Awaiting reply'}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Assigned work</CardTitle>
            <CardDescription>Tasks waiting on you and your team</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" disabled>
                View all
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            <ul className="divide-y">
              {ASSIGNED_TASKS.map((task) => {
                const overdue = daysUntil(task.dueDate) < 0;

                return (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: task.projectColor }}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{task.project}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <TaskPriorityBadge priority={task.priority} />
                      <TaskStatusBadge status={task.status} />
                      <span
                        className={cn(
                          'w-20 text-right text-xs tabular-nums',
                          overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {formatDueDate(task.dueDate)}
                      </span>
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[10px]">
                          {initials(task.assignee.name)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
            <CardDescription>Next two weeks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {UPCOMING_DEADLINES.map((deadline) => {
              const overdue = daysUntil(deadline.dueDate) < 0;

              return (
                <div key={deadline.id} className="flex items-start gap-3">
                  <CalendarClock
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      overdue ? 'text-destructive' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{deadline.title}</p>
                    <p
                      className={cn(
                        'text-xs',
                        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {formatDueDate(deadline.dueDate)} · {deadline.kind}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Project progress</CardTitle>
            <CardDescription>Completion across active projects</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            {PROJECT_PROGRESS.map((project) => {
              const percent = percentage(project.completed, project.total);

              return (
                <div key={project.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="text-sm font-medium">{project.name}</span>
                    <Badge variant="muted" className="font-mono text-[10px]">
                      {project.key}
                    </Badge>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {project.completed}/{project.total} · {percent}%
                    </span>
                  </div>

                  <Progress
                    value={percent}
                    aria-label={`${project.name} is ${percent} percent complete`}
                  />

                  <div className="flex items-center justify-between">
                    <div className="flex -space-x-1.5">
                      {project.members.slice(0, 4).map((member) => (
                        <Avatar
                          key={member}
                          className="size-5 ring-2 ring-background"
                          title={member}
                        >
                          <AvatarFallback className="text-[9px]">{initials(member)}</AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Due {formatDueDate(project.dueDate)}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Activity className="size-3.5" aria-hidden="true" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {RECENT_ACTIVITY.map((item) => (
              <div key={item.id} className="flex gap-2.5">
                <Avatar className="mt-0.5 size-6 shrink-0">
                  <AvatarFallback className="text-[10px]">{initials(item.actor)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{item.actor}</span>{' '}
                    <span className="text-muted-foreground">{item.action}</span>{' '}
                    <span>{item.target}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Ticket className="size-3.5" aria-hidden="true" />
            Recent tickets
          </CardTitle>
          <CardDescription>Latest reports across the workspace</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <ul className="divide-y">
            {RECENT_TICKETS.map((ticket) => (
              <li
                key={ticket.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {ticket.key}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{ticket.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ticket.reporter} · {formatRelativeTime(ticket.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <TicketPriorityBadge priority={ticket.priority} />
                  <TicketStatusBadge status={ticket.status} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
        <CircleCheckBig className="size-3.5" aria-hidden="true" />
        Workspace <span className="font-mono">{workspace.slug}</span> · ticket prefix{' '}
        <span className="font-mono">{workspace.ticketPrefix}</span>
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
