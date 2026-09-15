import { Link, Outlet, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, FolderKanban } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusUpdateComposer } from '@/features/portfolios/components/status-update-composer';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';
import { useProjectRealtime } from '@/features/work-items/hooks/use-project-realtime';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import {
  useProjectStatusUpdate,
  type ProjectStatusUpdateValue,
} from '@/stores/status-update.store';

import { CustomizePanel } from '../components/customize/customize-panel';
import { ProjectFormDialog } from '../components/project-form-dialog';
import { ProjectHeader } from '../components/project-header';
import { ProjectViewTabs } from '../components/project-view-tabs';
import { ShareProjectDialog } from '../components/sharing/share-project-dialog';
import { ViewToolbarProvider, ViewToolbarSlot } from '../components/view-toolbar-slot';
import { useJoinProject, useLeaveProject } from '../hooks/use-project-members';
import { useArchiveProject, useProject } from '../hooks/use-projects';
import { useProjectAccess } from '../lib/project-access';

/**
 * The project shell, laid out the way Asana lays out a project: team
 * breadcrumb over an icon tile, the name with its actions caret, star and
 * "Set status", the view tabs, then whatever view is open. The old summary
 * strip is gone — progress and dates are the Overview tab's job — so the
 * views get the height back.
 *
 * Everything below reads the reader's standing *in this project* off the
 * summary's `access`, never the workspace role: a viewer here gets a read-only
 * project whatever they may do elsewhere.
 */
export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const { data: project, isLoading, isError, error } = useProject(workspaceId, projectId);
  const access = useProjectAccess(project);

  /*
   * Mounted on the page that owns the project rather than in each view, so
   * switching between List and Board does not leave and rejoin the room — and
   * so a change that arrives mid-switch is not missed by both.
   */
  useProjectRealtime(workspaceId, projectId);
  const archiveProject = useArchiveProject(workspaceId);
  const joinProject = useJoinProject(workspaceId);
  const leaveProject = useLeaveProject(workspaceId);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  /** Non-null while the status composer is open — the same one portfolios use. */
  const [composeStatus, setComposeStatus] = useState<ProjectStatusUpdateValue | null>(null);
  const statusUpdate = useProjectStatusUpdate(projectId);

  /*
   * The Customize panel lives in the URL like the open task does: it survives
   * a tab switch and a reload, and Back puts it away. Opening pushes and
   * drops `?task=` — the two panels share the right edge, so one at a time.
   */
  const navigate = useNavigate();
  const routeSearch: Partial<{ customize: boolean }> = useSearch({ strict: false });
  const customizeOpen = routeSearch.customize === true;

  const openCustomize = () =>
    void navigate({
      to: '.',
      search: (previous) => ({ ...previous, customize: true, task: undefined }),
      resetScroll: false,
    });

  const closeCustomize = () =>
    void navigate({
      to: '.',
      search: (previous) => ({ ...previous, customize: undefined }),
      replace: true,
      resetScroll: false,
    });

  /** A private project 404s on the next refetch once the reader has left it, so leave the route first. */
  const leftPrivateProject = () => void navigate({ to: '/projects' });

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
              ? // The API does not say which: an invisible private project must
                // look exactly like one that does not exist.
                'It may have been deleted, it may be private to its members, or it belongs to a different workspace.'
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
  const role = access.effectiveRole;

  return (
    <div className="space-y-3">
      <ProjectHeader
        project={project}
        access={access}
        statusUpdate={statusUpdate}
        customizeOpen={customizeOpen}
        joinPending={joinProject.isPending}
        onEdit={() => setEditOpen(true)}
        onArchive={() => archiveProject.mutate({ projectId: project.id, archived })}
        onShare={() => setShareOpen(true)}
        onJoin={() => joinProject.mutate({ projectId: project.id, name: project.name })}
        onLeave={() =>
          access.isPrivate
            ? setShareOpen(true)
            : leaveProject.mutate({ projectId: project.id, name: project.name })
        }
        onSetStatus={setComposeStatus}
        onCustomize={openCustomize}
      />

      {/*
        The provider spans the rows and the view below them, because the slot is
        up here and whatever fills it renders down there — see
        `view-toolbar-slot`. Tabs and toolbar are separate rows, as in Asana.
      */}
      <ViewToolbarProvider>
        <div className="border-b">
          <ProjectViewTabs projectId={project.id} />
        </div>

        <ViewToolbarSlot />

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

      <ShareProjectDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        workspaceId={workspaceId}
        project={project}
        access={access}
        onLeft={leftPrivateProject}
      />

      <TaskDetailDialog
        workspaceId={workspaceId}
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        role={role}
      />

      {composeStatus && (
        <StatusUpdateComposer
          project={project}
          initialStatus={composeStatus}
          onClose={() => setComposeStatus(null)}
        />
      )}

      <CustomizePanel
        workspaceId={workspaceId}
        projectId={project.id}
        role={role}
        open={customizeOpen}
        onClose={closeCustomize}
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
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading project</span>
      <Skeleton className="h-3 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="h-7 w-72" />
      </div>
      <Skeleton className="h-8 w-full max-w-md" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
