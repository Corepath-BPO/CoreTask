import { WorkItemType, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link, Outlet, useNavigate, useSearch } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  Circle,
  FolderKanban,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Star,
  Ticket,
} from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusUpdateChip, StatusUpdateMenu } from '@/features/portfolios/components/status-update';
import { StatusUpdateComposer } from '@/features/portfolios/components/status-update-composer';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';
import { useProjectRealtime } from '@/features/work-items/hooks/use-project-realtime';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import { initials } from '@/lib/utils';
import {
  useProjectStatusUpdate,
  type ProjectStatusUpdateValue,
} from '@/stores/status-update.store';

import { CustomizePanel } from '../components/customize/customize-panel';
import { ProjectFormDialog } from '../components/project-form-dialog';
import { ProjectViewTabs } from '../components/project-view-tabs';
import { ViewToolbarProvider, ViewToolbarSlot } from '../components/view-toolbar-slot';
import { useArchiveProject, useProject } from '../hooks/use-projects';

/**
 * The project shell, laid out the way Asana lays out a project: team
 * breadcrumb over an icon tile, the name with its actions caret, star and
 * "Set status", the view tabs, then whatever view is open. The old summary
 * strip is gone — progress and dates are the Overview tab's job — so the
 * views get the height back.
 */
export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const { data: project, isLoading, isError, error } = useProject(workspaceId, projectId);

  /*
   * Mounted on the page that owns the project rather than in each view, so
   * switching between List and Board does not leave and rejoin the room — and
   * so a change that arrives mid-switch is not missed by both.
   */
  useProjectRealtime(workspaceId, projectId);
  const archiveProject = useArchiveProject(workspaceId);
  const [editOpen, setEditOpen] = useState(false);
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
  const TileIcon = project.defaultWorkItemType === WorkItemType.TICKET ? Ticket : List;

  return (
    <div className="space-y-3">
      {/* Asana puts the team where a breadcrumb would go; it links back to the
          browse page already filtered to that team. */}
      <Link
        to="/projects"
        search={project.team ? { teamId: project.team.id } : {}}
        className="inline-block text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {project.team?.name ?? 'Projects'}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ backgroundColor: project.color }}
        >
          <TileIcon className="size-4" />
        </span>

        <h1 className="max-w-[40rem] truncate text-xl font-semibold tracking-tight">
          {project.name}
        </h1>

        {(canEdit || canManage) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {canEdit && (
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil />
                  Edit project
                </DropdownMenuItem>
              )}
              {canEdit && canManage && <DropdownMenuSeparator />}
              {canManage && (
                <DropdownMenuItem
                  variant={archived ? 'default' : 'destructive'}
                  onSelect={() => archiveProject.mutate({ projectId: project.id, archived })}
                >
                  {archived ? <ArchiveRestore /> : <Archive />}
                  {archived ? 'Restore project' : 'Archive project'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          title="Starring projects is not built yet"
          aria-label="Star project (not built yet)"
        >
          <Star />
        </Button>

        {/* Asana's "Set status" — the portfolios status machinery, from the
            project itself. Picking a status opens the composer. */}
        <StatusUpdateMenu
          onPick={setComposeStatus}
          trigger={
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              {statusUpdate ? (
                <StatusUpdateChip status={statusUpdate.status} />
              ) : (
                <>
                  <Circle className="size-3" aria-hidden="true" />
                  Set status
                </>
              )}
            </Button>
          }
        />

        {archived && <Badge variant="muted">Archived</Badge>}

        <div className="ml-auto flex items-center gap-2">
          {project.lead && (
            <Avatar className="size-7" title={`${project.lead.name} — lead`}>
              {project.lead.avatarUrl && <AvatarImage src={project.lead.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">{initials(project.lead.name)}</AvatarFallback>
            </Avatar>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Joining needs project membership — not built yet"
          >
            <Lock />
            Join
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={customizeOpen}
            onClick={openCustomize}
            className="hidden sm:inline-flex"
          >
            <LayoutGrid />
            Customize
          </Button>
        </div>
      </div>

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
