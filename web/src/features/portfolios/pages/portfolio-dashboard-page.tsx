import { LayoutDashboard } from 'lucide-react';
import { useMemo } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useLatestStatusUpdates } from '@/features/projects/hooks/use-project-updates';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { percentage } from '@/lib/utils';

import { StatusUpdateChip } from '../components/status-update';
import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';
import { usePortfolioTasks } from '../hooks/use-portfolio-tasks';
import { usePortfolio } from '../hooks/use-portfolios';
import { rollupPortfolio } from '../lib/rollup';
import { STATUS_UPDATE_OPTIONS } from '../lib/status-updates';
import { workloadByPerson } from '../lib/workload';

/**
 * The portfolio's Dashboard — its projects in four numbers and two charts:
 * how much is done, how much is late, and where each project stands.
 */
export function PortfolioDashboardPage({ portfolioId }: { portfolioId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { portfolio, isLoading } = usePortfolio(workspaceId, portfolioId);
  const { projectsById, isLoading: projectsLoading } = usePortfolioProjectIndex(workspaceId);
  const { tasks, isLoading: tasksLoading } = usePortfolioTasks(
    workspaceId,
    portfolio?.projectIds ?? [],
  );
  const { data: latest } = useLatestStatusUpdates(workspaceId);

  const rollup = useMemo(
    () => (portfolio ? rollupPortfolio(portfolio, projectsById) : null),
    [portfolio, projectsById],
  );
  const overdue = useMemo(
    () => workloadByPerson(tasks, new Date()).reduce((sum, row) => sum + row.overdue, 0),
    [tasks],
  );

  if (isLoading || projectsLoading || tasksLoading || !rollup) {
    return (
      <div className="grid gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (rollup.projects.length === 0) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <EmptyState
          icon={LayoutDashboard}
          title="Nothing to chart yet"
          description="Add projects to this portfolio to see their numbers together."
        />
      </div>
    );
  }

  const stats = [
    { label: 'Projects', value: rollup.projects.length },
    { label: 'Tasks', value: rollup.taskCount },
    { label: 'Completed', value: `${rollup.progress}%` },
    { label: 'Overdue', value: overdue },
  ];

  const statusCounts = STATUS_UPDATE_OPTIONS.map((option) => ({
    option,
    count: rollup.projects.filter((project) => latest?.[project.id]?.status === option.value)
      .length,
  })).filter((entry) => entry.count > 0);
  const withoutUpdate = rollup.projects.filter((project) => !latest?.[project.id]).length;

  return (
    <div className="h-full space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="space-y-1 py-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Completion by project</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {rollup.projects.map((project) => {
                const done = percentage(project.completedTaskCount, project.taskCount);
                return (
                  <li key={project.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: project.color }}
                        />
                        <span className="truncate">{project.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {project.completedTaskCount}/{project.taskCount} · {done}%
                      </span>
                    </div>
                    <Progress value={done} aria-label={`${project.name} is ${done}% complete`} />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {statusCounts.map(({ option, count }) => (
                <li key={option.value} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0">
                    <StatusUpdateChip status={option.value} />
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-foreground/60"
                      style={{ width: `${(count / rollup.projects.length) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 text-right tabular-nums">{count}</span>
                </li>
              ))}
              {withoutUpdate > 0 && (
                <li className="text-sm text-muted-foreground">
                  {withoutUpdate} {withoutUpdate === 1 ? 'project has' : 'projects have'} no status
                  update yet
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
