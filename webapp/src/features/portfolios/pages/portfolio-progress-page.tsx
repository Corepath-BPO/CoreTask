import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useLatestStatusUpdates,
  useRequestProjectStatus,
  type ProjectStatusUpdateValue,
} from '@/features/projects/hooks/use-project-updates';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatRelativeTime } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { PortfolioStatusHistory } from '../components/portfolio-status-history';
import { StatusUpdateComposer } from '../components/status-update-composer';
import { StatusUpdateChip, StatusUpdateMenu } from '../components/status-update';
import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';
import { usePortfolio } from '../hooks/use-portfolios';
import { STATUS_UPDATE_OPTIONS } from '../lib/status-updates';
import { rollupPortfolio } from '../lib/rollup';

/**
 * The portfolio's Progress tab — every project's newest status update, side
 * by side, with how many are on track, at risk and the rest.
 *
 * Statuses are posted from each project (or from here); this tab is where a
 * portfolio owner reads them together.
 */
export function PortfolioProgressPage({ portfolioId }: { portfolioId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { portfolio, isLoading } = usePortfolio(workspaceId, portfolioId);
  const { projectsById, isLoading: projectsLoading } = usePortfolioProjectIndex(workspaceId);
  const { data: latest } = useLatestStatusUpdates(workspaceId);
  const currentUser = useCurrentUser();
  const requestStatus = useRequestProjectStatus(workspaceId);
  const isManager = hasAtLeastRole(workspace?.role ?? WorkspaceRole.GUEST, WorkspaceRole.MANAGER);
  const [composing, setComposing] = useState<{
    projectId: string;
    status: ProjectStatusUpdateValue;
  } | null>(null);

  const projects = useMemo(
    () => (portfolio ? rollupPortfolio(portfolio, projectsById).projects : []),
    [portfolio, projectsById],
  );

  // Newest update first; projects nobody has reported on after them.
  const ordered = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const left = latest?.[a.id]?.updatedAt ?? '';
        const right = latest?.[b.id]?.updatedAt ?? '';
        return right.localeCompare(left);
      }),
    [projects, latest],
  );

  const counts = useMemo(() => {
    const tally = new Map<ProjectStatusUpdateValue | 'none', number>();
    for (const project of projects) {
      const key = latest?.[project.id]?.status ?? 'none';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    return tally;
  }, [projects, latest]);

  const composingProject = composing ? projectsById.get(composing.projectId) : undefined;

  return (
    <div className="h-full space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
      {workspaceId && (
        <div className="mx-auto max-w-4xl">
          <PortfolioStatusHistory
            workspaceId={workspaceId}
            portfolioId={portfolioId}
            canDelete={(update) => isManager || update.author?.id === currentUser?.id}
          />
        </div>
      )}
      {isLoading || projectsLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No projects to report on"
          description="Add projects to this portfolio to follow their status updates here."
        />
      ) : (
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="flex flex-wrap items-center gap-3" aria-label="Status summary">
            {STATUS_UPDATE_OPTIONS.filter((option) => counts.get(option.value)).map((option) => (
              <span key={option.value} className="flex items-center gap-1.5 text-sm">
                <StatusUpdateChip status={option.value} />
                <span className="tabular-nums text-muted-foreground">
                  {counts.get(option.value)}
                </span>
              </span>
            ))}
            {counts.get('none') ? (
              <span className="text-sm text-muted-foreground">
                {counts.get('none')} without an update
              </span>
            ) : null}
          </div>

          <ul className="space-y-3">
            {ordered.map((project) => {
              const update = latest?.[project.id] ?? null;
              return (
                <li key={project.id}>
                  <Card>
                    <CardContent className="space-y-2 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          to="/projects/$projectId/messages"
                          params={{ projectId: project.id }}
                          className="flex min-w-0 items-center gap-2 font-medium hover:underline"
                        >
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: project.color }}
                          />
                          <span className="truncate">{project.name}</span>
                        </Link>
                        <StatusUpdateMenu
                          onPick={(status) => setComposing({ projectId: project.id, status })}
                          onRequest={
                            project.lead && project.lead.id !== currentUser?.id
                              ? () => requestStatus.mutate(project.id)
                              : undefined
                          }
                        />
                      </div>

                      {update ? (
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusUpdateChip status={update.status} />
                            {update.title && (
                              <span className="text-sm font-medium">{update.title}</span>
                            )}
                          </div>
                          {update.note && (
                            <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                              {update.note}
                            </p>
                          )}
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {update.author && (
                              <PersonAvatar
                                name={update.author.name}
                                avatarUrl={update.author.avatarUrl}
                                className="size-4"
                                fallbackClassName="text-[8px]"
                              />
                            )}
                            {update.author?.name ?? 'Someone'} ·{' '}
                            {formatRelativeTime(update.updatedAt)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No status update yet.</p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {composing && composingProject && (
        <StatusUpdateComposer
          project={composingProject}
          initialStatus={composing.status}
          onClose={() => setComposing(null)}
        />
      )}
    </div>
  );
}
