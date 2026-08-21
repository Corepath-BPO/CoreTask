import type { ProjectSummary } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { ArrowRightToLine, CalendarDays, FolderKanban, Link2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, daysUntil, formatDate, formatDueDate, initials, percentage } from '@/lib/utils';
import { usePortfolio, usePortfolioStore } from '@/stores/portfolio.store';
import {
  useProjectStatusUpdate,
  type ProjectStatusUpdateValue,
} from '@/stores/status-update.store';

import { AddProjectsDialog } from '../components/add-projects-dialog';
import {
  ProjectStatusUpdateChip,
  StatusUpdateChip,
  StatusUpdateMenu,
} from '../components/status-update';
import { StatusUpdateComposer } from '../components/status-update-composer';
import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';
import { rollupPortfolio } from '../lib/rollup';

/**
 * The List tab: the portfolio's projects as a spreadsheet-style table.
 * Clicking a row slides a detail panel in from the right, Asana-style —
 * the panel is a preview; "Open project" is the way into the full page.
 */
export function PortfolioListPage({ portfolioId }: { portfolioId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const portfolio = usePortfolio(workspaceId, portfolioId);
  const removeProject = usePortfolioStore((state) => state.removeProject);
  const { projectsById, isLoading } = usePortfolioProjectIndex(workspaceId);

  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The shell already renders the not-found state; this tab has nothing to add.
  if (!workspaceId || !portfolio) return null;

  const rollup = rollupPortfolio(portfolio, projectsById);
  const selected = selectedId ? (projectsById.get(selectedId) ?? null) : null;

  const handleRemove = (project: ProjectSummary) => {
    removeProject(workspaceId, portfolio.id, project.id);
    if (selectedId === project.id) setSelectedId(null);
    toast.success(`"${project.name}" removed from ${portfolio.name}`);
  };

  return (
    <div className="relative h-full overflow-hidden">
      {/*
        When the panel opens, the list pane narrows with it (the margin
        animates in step with the slide), and the scroll area below the
        toolbar owns both axes — so the horizontal scrollbar sits at the
        bottom of the visible pane and the columns the panel covers stay
        reachable, exactly as in Asana. On small screens the panel covers
        everything, so the margin only applies where a split makes sense.
      */}
      <div
        className={cn(
          'flex h-full flex-col transition-[margin-right] duration-300 ease-in-out',
          selected !== null && 'lg:mr-[42rem]',
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-4 sm:px-6">
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add projects
          </Button>
          {rollup.projects.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {rollup.projects.length} {rollup.projects.length === 1 ? 'project' : 'projects'}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-3 sm:px-6">
          {isLoading ? (
            <div className="space-y-2" role="status" aria-live="polite">
              <span className="sr-only">Loading projects</span>
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : rollup.projects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects in this portfolio"
              description="Add projects to watch their status, progress and dates side by side."
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add projects
                </Button>
              }
            />
          ) : (
            <table className="w-full min-w-[64rem] border-b text-sm">
              <thead>
                <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                  <th scope="col" className="border-r border-border/40 px-3 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="border-r border-border/40 px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="border-r border-border/40 px-3 py-2 font-medium">
                    Task progress
                  </th>
                  <th scope="col" className="border-r border-border/40 px-3 py-2 font-medium">
                    Due date
                  </th>
                  <th scope="col" className="border-r border-border/40 px-3 py-2 font-medium">
                    Lead
                  </th>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rollup.projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    selected={selectedId === project.id}
                    onSelect={() => setSelectedId(project.id)}
                    onRemove={() => handleRemove(project)}
                  />
                ))}
              </tbody>
            </table>
          )}

          {!isLoading && rollup.missingCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {rollup.missingCount} referenced {rollup.missingCount === 1 ? 'project' : 'projects'}{' '}
              could not be found — likely deleted since being added here.
            </p>
          )}
        </div>
      </div>

      <ProjectSidePanel project={selected} onClose={() => setSelectedId(null)} />

      <AddProjectsDialog
        open={adding}
        onOpenChange={setAdding}
        workspaceId={workspaceId}
        portfolio={portfolio}
      />
    </div>
  );
}

interface ProjectRowProps {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function ProjectRow({ project, selected, onSelect, onRemove }: ProjectRowProps) {
  const archived = project.archivedAt !== null;
  const progress = percentage(project.completedTaskCount, project.taskCount);
  const overdue = project.dueDate !== null && !archived && daysUntil(project.dueDate) < 0;

  return (
    <tr
      onClick={onSelect}
      className={cn(
        'group cursor-pointer transition-colors',
        selected ? 'bg-muted/60' : 'hover:bg-muted/30',
        archived && 'opacity-70',
      )}
    >
      <td className="border-r border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: project.color }}
          />
          {/* A button rather than relying on the row's onClick, so the panel
              opens from the keyboard too. */}
          <button
            type="button"
            onClick={onSelect}
            className="max-w-56 truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {project.name}
          </button>
          <Badge variant="outline" className="font-mono text-[10px]">
            {project.key}
          </Badge>
          {archived && <Badge variant="muted">Archived</Badge>}
        </div>
      </td>

      <td className="border-r border-border/40 px-3 py-2">
        <ProjectStatusUpdateChip projectId={project.id} />
      </td>

      <td className="border-r border-border/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Progress
            value={progress}
            className="h-1.5 w-24"
            aria-label={`${project.name} is ${progress}% complete`}
          />
          <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
        </div>
      </td>

      <td
        className={cn(
          'whitespace-nowrap border-r border-border/40 px-3 py-2 text-xs text-muted-foreground',
          overdue && 'font-medium text-destructive',
        )}
      >
        {project.dueDate ? formatDueDate(project.dueDate) : '—'}
      </td>

      <td className="border-r border-border/40 px-3 py-2">
        {project.lead ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar className="size-5">
              {project.lead.avatarUrl && <AvatarImage src={project.lead.avatarUrl} alt="" />}
              <AvatarFallback className="text-[9px]">{initials(project.lead.name)}</AvatarFallback>
            </Avatar>
            <span className="max-w-28 truncate">{project.lead.name}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      <td className="px-3 py-2 text-right">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${project.name} from this portfolio`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X />
        </Button>
      </td>
    </tr>
  );
}

/**
 * Detail panel that slides in from the right when a row is selected, like
 * Asana's: it covers the list rather than squeezing it, spans from just below
 * the portfolio tabs to the bottom edge, and takes a good share of the window.
 * Clicking another row swaps the content in place, and the body scrolls on
 * its own below the fixed action bar.
 */
function ProjectSidePanel({
  project,
  onClose,
}: {
  project: ProjectSummary | null;
  onClose: () => void;
}) {
  // Keep the last project on screen while the panel slides shut, so closing
  // animates a real panel away instead of a suddenly empty one.
  const [lastProject, setLastProject] = useState(project);
  if (project !== null && project !== lastProject) setLastProject(project);

  const shown = project ?? lastProject;
  const open = project !== null;
  const tabbable = open ? 0 : -1;

  // Called unconditionally — hooks cannot sit behind the `shown` guard below.
  const statusUpdate = useProjectStatusUpdate(shown?.id ?? '');

  /** Status picked from the menu; non-null while the composer is open. */
  const [composeStatus, setComposeStatus] = useState<ProjectStatusUpdateValue | null>(null);

  const copyLink = () => {
    if (!shown) return;
    void navigator.clipboard.writeText(`${window.location.origin}/projects/${shown.id}`).then(
      () => toast.success('Project link copied'),
      () => toast.error('Could not copy the link'),
    );
  };

  const overdue =
    shown !== null &&
    shown.dueDate !== null &&
    shown.archivedAt === null &&
    daysUntil(shown.dueDate) < 0;

  return (
    <aside
      aria-label={shown ? `Details for ${shown.name}` : 'Project details'}
      aria-hidden={!open}
      className={cn(
        'absolute inset-y-0 right-0 z-10 w-full max-w-[42rem] border-l bg-card shadow-xl transition-transform duration-300 ease-in-out',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {shown && (
        <div className="flex h-full flex-col">
          {/* Fixed top bar, like Asana's: the way into the project on the
                left, utilities on the right. Everything below it scrolls. */}
          <div className="flex items-center gap-1 border-b px-3 py-2">
            <Button variant="outline" size="sm" asChild tabIndex={tabbable}>
              <Link to="/projects/$projectId" params={{ projectId: shown.id }}>
                View project
              </Link>
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy project link"
                onClick={copyLink}
                tabIndex={tabbable}
              >
                <Link2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close project details"
                onClick={onClose}
                tabIndex={tabbable}
              >
                <ArrowRightToLine />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-4 shrink-0 rounded-md"
                  style={{ backgroundColor: shown.color }}
                />
                <h2 className="min-w-0 flex-1 break-words text-2xl font-semibold leading-tight">
                  {shown.name}
                </h2>
              </div>

              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                {shown.dueDate ? (
                  <span className={cn(overdue && 'font-medium text-destructive')}>
                    Due {formatDate(shown.dueDate)}
                  </span>
                ) : (
                  'No due date'
                )}
              </p>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {shown.key}
                </Badge>
                <ProjectStatusBadge status={shown.status} />
                {shown.archivedAt !== null && <Badge variant="muted">Archived</Badge>}
                {shown.team && (
                  <Badge variant="outline" className="gap-1">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: shown.team.color }}
                    />
                    {shown.team.name}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Progress
                  value={percentage(shown.completedTaskCount, shown.taskCount)}
                  className="h-1.5 flex-1"
                  aria-label={`${percentage(shown.completedTaskCount, shown.taskCount)}% complete`}
                />
                <span className="text-xs font-semibold tabular-nums">
                  {percentage(shown.completedTaskCount, shown.taskCount)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {shown.completedTaskCount}/{shown.taskCount} tasks
                </span>
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Share a status update</h3>
              <div className="space-y-3 rounded-lg border p-4">
                {statusUpdate ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusUpdateChip status={statusUpdate.status} />
                      <span className="text-xs text-muted-foreground">
                        Updated {formatDate(statusUpdate.updatedAt)}
                      </span>
                    </div>
                    {statusUpdate.note && <p className="text-sm">{statusUpdate.note}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Update your team and others on the progress of this project.
                  </p>
                )}
                <StatusUpdateMenu onPick={setComposeStatus} tabIndex={tabbable} />
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                Connected goals
                <Badge variant="muted" className="text-[10px]">
                  Soon
                </Badge>
              </h3>
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  Connect or create a goal to link this project to a larger purpose.
                </p>
                <Button variant="outline" size="sm" disabled>
                  Add goal
                </Button>
              </div>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">Description</h3>
              <p className="text-sm">
                {shown.description || <span className="text-muted-foreground">No description</span>}
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Members</h3>
              {shown.lead ? (
                <div className="flex items-center gap-2 text-sm">
                  <Avatar className="size-6">
                    {shown.lead.avatarUrl && <AvatarImage src={shown.lead.avatarUrl} alt="" />}
                    <AvatarFallback className="text-[9px]">
                      {initials(shown.lead.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{shown.lead.name}</span>
                  <span className="text-xs text-muted-foreground">Lead</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No lead assigned.</p>
              )}
              {shown.startDate && (
                <p className="text-xs text-muted-foreground">
                  Started {formatDate(shown.startDate)}
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      {composeStatus !== null && shown && (
        <StatusUpdateComposer
          project={shown}
          initialStatus={composeStatus}
          onClose={() => setComposeStatus(null)}
        />
      )}
    </aside>
  );
}
