import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link, Outlet } from '@tanstack/react-router';
import { Archive, ArchiveRestore, ArrowLeft, FolderKanban, Pencil } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import { cn, daysUntil, formatDate, initials, percentage } from '@/lib/utils';

import { ProjectFormDialog } from '../components/project-form-dialog';
import { ProjectStatusBadge } from '../components/project-status-badge';
import { ProjectViewTabs } from '../components/project-view-tabs';
import { ViewToolbarProvider, ViewToolbarSlot } from '../components/view-toolbar-slot';
import { useArchiveProject, useProject } from '../hooks/use-projects';

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const { data: project, isLoading, isError, error } = useProject(workspaceId, projectId);
  const archiveProject = useArchiveProject(workspaceId);
  const [editOpen, setEditOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canManage = hasAtLeastRole(role, WorkspaceRole.MANAGER);

  if (workspaceLoading || isLoading) return <ProjectDetailSkeleton />;

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;

    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={FolderKanban}
          title={notFound ? 'Project not found' : 'Could not load this project'}
          description={
            notFound
              ? 'It may have been deleted, or it belongs to a different workspace.'
              : error instanceof Error
                ? error.message
                : 'Please try again.'
          }
          action={
            <Button asChild variant="outline">
              <Link to="/projects">Back to projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!project) return null;

  const archived = project.archivedAt !== null;
  const progress = percentage(project.completedTaskCount, project.taskCount);
  const overdue = project.dueDate !== null && !archived && daysUntil(project.dueDate) < 0;

  return (
    <div className="space-y-3">
      <BackLink />

      <PageHeader
        title={project.name}
        description={project.description ?? 'No description'}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil />
                Edit
              </Button>
            )}
            {canManage && (
              <Button
                variant={archived ? 'default' : 'outline'}
                size="sm"
                onClick={() => archiveProject.mutate({ projectId: project.id, archived })}
                loading={archiveProject.isPending}
              >
                {archived ? <ArchiveRestore /> : <Archive />}
                {archived ? 'Restore' : 'Archive'}
              </Button>
            )}
          </div>
        }
      />

      {/*
        One strip rather than three stat cards and a separate badge row.

        All of this sits above every tab, so its height came out of whatever the
        tab was showing — on the List and Board views that was most of the screen
        spent on summary above the grid people actually came to use. Nothing is
        dropped; it is one line instead of four, and the space goes to content.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2">
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
        <Badge variant="outline" className="font-mono text-[10px]">
          {project.key}
        </Badge>
        <ProjectStatusBadge status={project.status} />
        {archived && <Badge variant="muted">Archived</Badge>}
        {project.lead && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar className="size-5">
              {project.lead.avatarUrl && <AvatarImage src={project.lead.avatarUrl} alt="" />}
              <AvatarFallback className="text-[9px]">{initials(project.lead.name)}</AvatarFallback>
            </Avatar>
            {project.lead.name}
          </span>
        )}

        <span aria-hidden="true" className="h-4 w-px bg-border" />

        <div className="flex min-w-48 flex-1 items-center gap-2">
          <span className="text-xs text-muted-foreground">Progress</span>
          <Progress value={progress} className="h-1.5 flex-1" aria-label={`${progress}% complete`} />
          <span className="text-xs font-semibold tabular-nums">{progress}%</span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {project.completedTaskCount}/{project.taskCount} tasks
          </span>
        </div>

        <span className="whitespace-nowrap text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {project.sections.length}
          </span>{' '}
          sections
        </span>

        <span
          className={cn(
            'whitespace-nowrap text-xs text-muted-foreground',
            overdue && 'font-medium text-destructive',
          )}
        >
          {project.dueDate ? `Due ${formatDate(project.dueDate)}` : 'No due date'}
          {project.startDate ? ` · Started ${formatDate(project.startDate)}` : ''}
        </span>
      </div>

      {/*
        The provider spans the row and the view below it, because the slot is up
        here and whatever fills it renders down there — see `view-toolbar-slot`.
      */}
      <ViewToolbarProvider>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* `min-w-0` so the tabs scroll rather than shoving the controls off
              the row; `flex-wrap` on the parent still drops them to their own
              line once there is genuinely no space. */}
          <div className="min-w-0 flex-1">
            <ProjectViewTabs projectId={project.id} />
          </div>

          <ViewToolbarSlot />
        </div>

        {/*
          Each tab renders here. The board is one representation of the project,
          not the project itself — which is why it lives on its own route rather
          than being the page.
        */}
        <Outlet />
      </ViewToolbarProvider>

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        workspaceId={workspaceId}
        project={project}
      />

      <TaskDetailDialog
        workspaceId={workspaceId}
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        role={role}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/projects"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Projects
    </Link>
  );
}

function ProjectDetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading project</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-56 w-72 shrink-0" />
        ))}
      </div>
    </div>
  );
}
