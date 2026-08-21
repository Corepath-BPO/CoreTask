import { BOARD_TASK_LIMIT, PAGINATION_MAX_LIMIT } from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, CircleGauge, FolderKanban, UsersRound } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/data-display/stat-card';
import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useTasks } from '@/features/tasks/hooks/use-tasks';
import { useTickets } from '@/features/tickets/hooks/use-tickets';
import {
  useActiveWorkspace,
  useWorkspaceMembers,
} from '@/features/workspaces/hooks/use-workspaces';

export function ReportsPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const tasks = useTasks(workspace?.id, { limit: BOARD_TASK_LIMIT });
  const tickets = useTickets(workspace?.id, { limit: PAGINATION_MAX_LIMIT, includeClosed: true });
  const projects = useProjects(workspace?.id, { limit: PAGINATION_MAX_LIMIT });
  const members = useWorkspaceMembers(workspace?.id);

  const isLoading =
    workspaceLoading ||
    tasks.isLoading ||
    tickets.isLoading ||
    projects.isLoading ||
    members.isLoading;
  if (isLoading) return <ReportsSkeleton />;
  if (!workspace)
    return (
      <EmptyState
        icon={FolderKanban}
        title="No workspace yet"
        description="Create a workspace to start measuring its work."
        className="mt-10"
      />
    );

  const taskSummary = tasks.data?.meta.summary ?? {
    total: 0,
    completed: 0,
    overdue: 0,
    unassigned: 0,
  };
  const ticketSummary = tickets.data?.meta.summary ?? {
    total: 0,
    open: 0,
    urgent: 0,
    resolved: 0,
    overdue: 0,
    unassigned: 0,
  };
  const completionRate = percent(taskSummary.completed, taskSummary.total);
  const resolutionRate = percent(ticketSummary.resolved, ticketSummary.total);
  const taskStatuses = counts(tasks.data?.items ?? [], (task) => task.status);
  const priorities = counts(tasks.data?.items ?? [], (task) => task.priority);
  const workload = (members.data ?? [])
    .map((member) => ({
      id: member.user.id,
      name: member.user.name,
      count: (tasks.data?.items ?? []).filter(
        (task) => task.assigneeId === member.user.id && !task.completedAt,
      ).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxWorkload = Math.max(1, ...workload.map((item) => item.count));
  const projectRows = (projects.data?.items ?? [])
    .slice()
    .sort((a, b) => b.taskCount - a.taskCount)
    .slice(0, 6);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Reports"
        description={`A live operational view of ${workspace.name}.`}
        actions={
          <Badge variant="outline" className="h-8">
            Workspace overview
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Task completion"
          value={`${completionRate}%`}
          hint={`${taskSummary.completed} of ${taskSummary.total} completed`}
          featured
        />
        <StatCard
          label="Ticket resolution"
          value={`${resolutionRate}%`}
          hint={`${ticketSummary.resolved} of ${ticketSummary.total} resolved`}
        />
        <StatCard
          label="Overdue work"
          value={taskSummary.overdue + ticketSummary.overdue}
          hint={`${taskSummary.overdue} tasks · ${ticketSummary.overdue} tickets`}
          invertDelta
        />
        <StatCard
          label="Unassigned"
          value={taskSummary.unassigned + ticketSummary.unassigned}
          hint="Tasks and tickets without an owner"
          invertDelta
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Project progress</CardTitle>
            <CardDescription>Completion across the busiest active projects.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-1">
            {projectRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects to report yet.</p>
            ) : (
              projectRows.map((project) => {
                const value = percent(project.completedTaskCount, project.taskCount);
                return (
                  <div key={project.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <Button
                        asChild
                        variant="link"
                        className="h-auto min-w-0 justify-start p-0 text-foreground"
                      >
                        <Link to="/projects/$projectId/board" params={{ projectId: project.id }}>
                          <span className="truncate">{project.name}</span>
                        </Link>
                      </Button>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {project.completedTaskCount}/{project.taskCount} · {value}%
                      </span>
                    </div>
                    <Progress value={value} />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open workload</CardTitle>
            <CardDescription>Tasks currently assigned to each teammate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            {workload.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members to report yet.</p>
            ) : (
              workload.map((member) => (
                <div
                  key={member.id}
                  className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3"
                >
                  <div>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="truncate">{member.name}</span>
                    </div>
                    <Progress
                      value={(member.count / maxWorkload) * 100}
                      indicatorClassName="bg-sky-500"
                    />
                  </div>
                  <span className="text-right text-sm font-semibold tabular-nums">
                    {member.count}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="Task status"
          description="Distribution of loaded workspace tasks."
          icon={<CircleGauge className="size-4 text-primary" />}
          data={taskStatuses}
        />
        <BreakdownCard
          title="Task priority"
          description="Where urgency is concentrated."
          icon={<AlertTriangle className="size-4 text-warning" />}
          data={priorities}
        />
      </div>

      <Card className="bg-muted/25">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-success" />
            <div>
              <p className="text-sm font-semibold">Live workspace data</p>
              <p className="text-xs text-muted-foreground">
                Summary totals cover the full workspace; breakdowns show up to {BOARD_TASK_LIMIT}{' '}
                task records.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/members">
              <UsersRound />
              Manage workload
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function BreakdownCard({
  title,
  description,
  icon,
  data,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  data: Record<string, number>;
}) {
  const total = Object.values(data).reduce((sum, value) => sum + value, 0);
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3">
              <span className="truncate text-xs font-medium capitalize">
                {label.replaceAll('_', ' ').toLowerCase()}
              </span>
              <Progress value={percent(value, total)} />
              <span className="text-right text-xs font-semibold tabular-nums">{value}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
function counts<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const key = getKey(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}
function percent(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}
function ReportsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-40 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
