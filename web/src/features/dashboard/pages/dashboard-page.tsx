import { Link } from '@tanstack/react-router';
import {
  Activity,
  CalendarClock,
  CircleCheckBig,
  FolderKanban,
  Ticket,
  UsersRound,
} from 'lucide-react';

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
  cn,
  daysUntil,
  formatDueDate,
  formatRelativeTime,
  initials,
  percentage,
} from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { useDashboardData } from '../hooks/use-dashboard';

export function DashboardPage() {
  const user = useCurrentUser();
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const {
    taskTiles,
    ticketTiles,
    assignedTasks,
    upcomingTasks,
    projects,
    recentTickets,
    recentActivity,
    isLoading,
  } = useDashboardData(workspace?.id);

  if (workspaceLoading || isLoading) return <DashboardSkeleton />;

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
    <div className="mx-auto w-full max-w-[1440px] space-y-8">
      <section className="surface-shadow overflow-hidden rounded-2xl border border-border/80 bg-card">
        <div className="px-5 py-6 sm:px-7 sm:py-7">
          <PageHeader
            title={`${greeting()}, ${user?.name.split(' ')[0] ?? 'there'}`}
            description={`Here is what is happening in ${workspace.name} today.`}
            actions={
              <Badge variant="outline" className="h-8 gap-2 rounded-lg bg-background/45 px-3">
                <UsersRound className="size-3.5 text-primary-strong" aria-hidden="true" />
                {workspace.memberCount} members
              </Badge>
            }
          />

          <section aria-labelledby="tasks-heading" className="mt-7">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 id="tasks-heading" className="text-sm font-semibold">
                Task overview
              </h2>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link to="/my-tasks">Open tasks</Link>
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.82fr)_2fr]">
              {taskTiles[0] && (
                <StatCard
                  label={taskTiles[0].label}
                  value={taskTiles[0].value}
                  hint={taskTiles[0].hint}
                  invertDelta={taskTiles[0].invert ?? false}
                  featured
                />
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                {taskTiles.slice(1).map((tile) => (
                  <StatCard
                    key={tile.label}
                    label={tile.label}
                    value={tile.value}
                    hint={tile.hint}
                    invertDelta={tile.invert ?? false}
                    className="min-h-44"
                  />
                ))}
              </div>
            </div>
          </section>
        </div>

        <section
          aria-labelledby="tickets-heading"
          className="border-t border-border/70 bg-muted/20 px-5 py-5 sm:px-7"
        >
          <div className="grid gap-4 xl:grid-cols-[180px_1fr] xl:items-center">
            <div>
              <h2 id="tickets-heading" className="flex items-center gap-2 text-sm font-semibold">
                <Ticket className="size-4 text-primary-strong" aria-hidden="true" />
                Ticket health
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Current workspace queue</p>
            </div>

            <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:divide-x sm:divide-border/70">
              {ticketTiles.map((tile) => (
                <div key={tile.label} className="min-w-0 px-0 sm:px-5 first:pl-0 last:pr-0">
                  <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums tracking-[-0.04em]">
                      {tile.value}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{tile.hint}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Your focus</h2>
        <p className="text-sm text-muted-foreground">Work that needs your attention next.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-h-64 overflow-hidden lg:col-span-2">
          <CardHeader>
            <CardTitle>Assigned to you</CardTitle>
            <CardDescription>Open work waiting on you</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link to="/my-tasks">View all</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            {assignedTasks.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                Nothing assigned to you right now.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {assignedTasks.map((task) => {
                  const overdue = task.dueDate !== null && daysUntil(task.dueDate) < 0;

                  return (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-center gap-3 px-6 py-4 transition-colors hover:bg-muted/45"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        {task.subtaskCount > 0 && (
                          <p className="truncate text-xs text-muted-foreground">
                            {task.completedSubtaskCount}/{task.subtaskCount} subtasks
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <TaskPriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                        {task.dueDate && (
                          <span
                            className={cn(
                              'w-20 text-right text-xs tabular-nums',
                              overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                            )}
                          >
                            {formatDueDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/15 bg-muted/25">
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
            <CardDescription>Next two weeks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {upcomingTasks.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No deadlines in the next two weeks.
              </p>
            ) : (
              upcomingTasks.map((task) => {
                const overdue = task.dueDate !== null && daysUntil(task.dueDate) < 0;

                return (
                  <div key={task.id} className="flex items-start gap-3">
                    <CalendarClock
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        overdue ? 'text-destructive' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{task.title}</p>
                      <p
                        className={cn(
                          'text-xs',
                          overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {task.dueDate ? formatDueDate(task.dueDate) : 'No due date'}
                        {task.assignee ? ` · ${task.assignee.name}` : ' · unassigned'}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-1 pt-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Workspace pulse</h2>
        <p className="text-sm text-muted-foreground">Progress and recent team movement.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Project progress</CardTitle>
            <CardDescription>Completion across active projects</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link to="/projects">View all</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            {projects.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No projects yet.{' '}
                <Link to="/projects" className="underline underline-offset-4">
                  Create one
                </Link>
                .
              </p>
            ) : (
              projects.map((project) => {
                const percent = percentage(project.completedTaskCount, project.taskCount);

                return (
                  <div key={project.id} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: project.color }}
                      />
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                        className="text-sm font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <Badge variant="muted" className="font-mono text-[10px]">
                        {project.key}
                      </Badge>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {project.completedTaskCount}/{project.taskCount} · {percent}%
                      </span>
                    </div>

                    <Progress
                      value={percent}
                      aria-label={`${project.name} is ${percent} percent complete`}
                    />

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {project.sectionCount} sections
                      </span>
                      {project.dueDate && (
                        <span className="text-xs text-muted-foreground">
                          Due {formatDueDate(project.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-muted/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Activity className="size-3.5" aria-hidden="true" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {recentActivity.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nothing has happened here yet.
              </p>
            ) : (
              recentActivity.map((item) => (
                <div key={item.id} className="flex gap-2.5">
                  <Avatar className="mt-0.5 size-6 shrink-0">
                    {/* A null actor is system activity: jobs and automations. */}
                    <AvatarFallback className="text-[10px]">
                      {item.actor ? initials(item.actor.name) : '••'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{item.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.actor?.name ?? 'CoreTask'} · {formatRelativeTime(item.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Ticket className="size-3.5" aria-hidden="true" />
            Recent tickets
          </CardTitle>
          <CardDescription>Latest reports across the workspace</CardDescription>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link to="/tickets">View all</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {recentTickets.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">
              No open tickets.{' '}
              <Link to="/tickets" className="underline underline-offset-4">
                Report one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {recentTickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex flex-wrap items-center gap-3 px-6 py-4 transition-colors hover:bg-muted/45"
                >
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {ticket.key}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ticket.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ticket.reporter?.name ?? 'Unknown reporter'} ·{' '}
                      {formatRelativeTime(ticket.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <TicketPriorityBadge priority={ticket.priority} />
                    <TicketStatusBadge status={ticket.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
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
