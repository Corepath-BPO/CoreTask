import { WorkspaceRole, hasAtLeastRole, type CreatableWorkItemType } from '@coretask/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { FolderKanban } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailPanel } from '@/features/tasks/components/task-detail-dialog';
import { CreateWorkItemDialog } from '@/features/work-items/components/create-work-item-dialog';
import { ProjectWorkItemCreateButton } from '@/features/work-items/components/project-work-item-create-button';
import {
  useCreateProjectWorkItem,
  useProjectWorkItems,
} from '@/features/work-items/hooks/use-project-work-items';
import { toWorkItemRow } from '@/features/work-items/lib/work-item-row';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { CreateSectionDialog } from '../components/create-section-dialog';
import { SectionBoard } from '../components/section-board';
import { ViewToolbar } from '../components/view-toolbar-slot';
import { useFieldMetadata } from '../hooks/use-project-views';
import { useCreateSection, useProject } from '../hooks/use-projects';

/** Accepts any RFC 4122 version, including the v7 ids this schema generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The Board tab — the Kanban that used to be the whole project page.
 *
 * Lifted onto its own route unchanged, so the drag-and-drop, section renaming
 * and inline task creation all behave exactly as before.
 */
export function ProjectBoardPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const { data: project, isLoading } = useProject(workspaceId, projectId);
  /*
   * The same query the List reads, so both views draw the same set.
   *
   * The Board used to read a task-only endpoint under its own cache key, which
   * is why a ticket filed from the List never appeared here and why creating on
   * the Board left the List stale. One query, one key, one answer.
   */
  const {
    data: workItems,
    isError: tasksFailed,
    error: tasksError,
    refetch: refetchTasks,
  } = useProjectWorkItems(workspaceId, projectId, { includeCustomFields: true });

  const tasks = useMemo(() => (workItems?.items ?? []).map(toWorkItemRow), [workItems]);
  const [composing, setComposing] = useState<CreatableWorkItemType | null>(null);

  /*
   * The open panel lives in the URL, not component state — same contract as
   * the List page: reload restores it, Copy link can copy it, Back closes it.
   * Re-validated because `useSearch({ strict: false })` returns raw params.
   */
  const navigate = useNavigate();
  const routeSearch: Partial<{ task: string }> = useSearch({ strict: false });
  const openTaskId =
    routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;

  // Push on open (Back closes), replace on swap and on close; `resetScroll:
  // false` keeps the router from jumping the page per open. See the List page.
  const openTask = (taskId: string) =>
    void navigate({
      to: '/projects/$projectId/board',
      params: { projectId },
      search: { task: taskId },
      replace: openTaskId !== null,
      resetScroll: false,
    });

  const closeTask = () =>
    void navigate({
      to: '/projects/$projectId/board',
      params: { projectId },
      search: {},
      replace: true,
      resetScroll: false,
    });

  const createWorkItem = useCreateProjectWorkItem(workspaceId, projectId);
  const createSection = useCreateSection(workspaceId, projectId);
  const [addingSection, setAddingSection] = useState(false);
  const { data: metadata } = useFieldMetadata(workspaceId, projectId);

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canManage = hasAtLeastRole(role, WorkspaceRole.MANAGER);
  const archived = Boolean(project?.archivedAt);

  if (isLoading || !project) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      {/* The same control the List carries, in the same place — see
          `view-toolbar-slot`. Both views offer one way to add to a project. */}
      <ViewToolbar>
        <ProjectWorkItemCreateButton
          defaultType={project.defaultWorkItemType}
          context={{ projectId, sourceView: 'BOARD' }}
          pending={createWorkItem.isPending}
          onCreate={(type) => setComposing(type as CreatableWorkItemType)}
          onCreateSection={() => setAddingSection(true)}
        />
      </ViewToolbar>

      {canEdit && (
        <p className="text-xs text-muted-foreground">
          Drag a column by its handle to reorder · click a name to rename
        </p>
      )}

      {/*
        Without this the board renders as "no tasks" whenever the task query
        fails — an empty board and a broken board look identical, and the empty
        one invites someone to re-create work that already exists.
      */}
      {tasksFailed && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-destructive">
              {tasksError instanceof Error
                ? `Could not load tasks: ${tasksError.message}`
                : 'Could not load tasks for this board.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetchTasks()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {project.sections.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No sections yet"
          description="Add a section to start shaping this board."
        />
      ) : (
        <SectionBoard
          workspaceId={workspaceId}
          projectId={project.id}
          sections={project.sections}
          tasks={tasks}
          totalTaskCount={tasks.length}
          canEdit={canEdit && !archived}
          canDelete={canManage && !archived}
          onOpenTask={openTask}
          onAddSection={() => setAddingSection(true)}
        />
      )}

      <CreateSectionDialog
        open={addingSection}
        onOpenChange={setAddingSection}
        metadata={metadata}
        pending={createSection.isPending}
        onSubmit={(payload) => createSection.mutateAsync(payload)}
      />

      <CreateWorkItemDialog
        open={composing !== null}
        onOpenChange={(next) => !next && setComposing(null)}
        initialType={composing ?? project.defaultWorkItemType}
        metadata={metadata}
        pending={createWorkItem.isPending}
        onSubmit={(payload) => createWorkItem.mutateAsync(payload)}
      />

      <TaskDetailPanel
        workspaceId={workspaceId}
        taskId={openTaskId}
        role={role}
        projectId={projectId}
        onOpenTask={openTask}
        onClose={closeTask}
      />
    </div>
  );
}
