import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link, Outlet } from '@tanstack/react-router';
import { Archive, ArchiveRestore, ArrowLeft, FolderKanban, Pencil } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import { cn, daysUntil, formatDate, initials, percentage } from '@/lib/utils';

import { ProjectFormDialog } from '../components/project-form-dialog';
import { ProjectStatusBadge } from '../components/project-status-badge';
import { ProjectViewTabs } from '../components/project-view-tabs';
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
    <div className="space-y-6">
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

      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="size-3 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
        <Badge variant="outline" className="font-mono text-[10px]">
          {project.key}
        </Badge>
        <ProjectStatusBadge status={project.status} />
        {archived && <Badge variant="muted">Archived</Badge>}
        {project.lead && (
          <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar className="size-5">
              {project.lead.avatarUrl && <AvatarImage src={project.lead.avatarUrl} alt="" />}
              <AvatarFallback className="text-[9px]">{initials(project.lead.name)}</AvatarFallback>
            </Avatar>
            {project.lead.name}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1.5 py-4">
            <p className="text-xs font-medium text-muted-foreground">Progress</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{progress}%</span>
              <span className="text-xs text-muted-foreground">
                {project.completedTaskCount}/{project.taskCount} tasks
              </span>
            </div>
            <Progress value={progress} aria-label={`${progress}% complete`} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="text-xs font-medium text-muted-foreground">Sections</p>
            <p className="text-2xl font-semibold tabular-nums">{project.sections.length}</p>
            <p className="text-xs text-muted-foreground">Columns on this board</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="text-xs font-medium text-muted-foreground">Timeline</p>
            <p className={cn('text-sm font-medium', overdue && 'text-destructive')}>
              {project.dueDate ? `Due ${formatDate(project.dueDate)}` : 'No due date'}
            </p>
            <p className="text-xs text-muted-foreground">
              {project.startDate ? `Started ${formatDate(project.startDate)}` : 'No start date'}
            </p>
          </CardContent>
        </Card>
      </div>

      <ProjectViewTabs projectId={project.id} />

      {/*
        Each tab renders here. The board is one representation of the project,
        not the project itself — which is why it lives on its own route rather
        than being the page.
      */}
      <Outlet />

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
