import {
  ProjectViewType,
  SystemField,
  WorkspaceRole,
  hasAtLeastRole,
  type CreatableWorkItemType,
} from '@coretask/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { FolderKanban } from 'lucide-react';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailPanel } from '@/features/tasks/components/task-detail-dialog';
import { CreateWorkItemDialog } from '@/features/work-items/components/create-work-item-dialog';
import { useShortcutActions } from '@/lib/shortcuts/shortcut-registry';
import { ProjectWorkItemCreateButton } from '@/features/work-items/components/project-work-item-create-button';
import {
  useCreateProjectWorkItem,
  useProjectWorkItems,
} from '@/features/work-items/hooks/use-project-work-items';
import { toWorkItemRow } from '@/features/work-items/lib/work-item-row';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { useCurrentUser } from '@/stores/auth.store';

import { CreateSectionDialog } from '../components/create-section-dialog';
import { GroupedBoard } from '../components/grouped-board';
import { SectionBoard } from '../components/section-board';
import { SaveViewDialog } from '../components/toolbar/save-view-dialog';
import { ViewToolbarControls } from '../components/toolbar/view-toolbar-controls';
import { ViewToolbar } from '../components/view-toolbar-slot';
import {
  canPersistView,
  useActiveView,
  useCreateProjectView,
  useFieldMetadata,
  useProjectViews,
  useViewSettingsEditor,
} from '../hooks/use-project-views';
import { useCreateSection, useProject } from '../hooks/use-projects';
import { isManualOrder } from '../lib/group-value';

/** Accepts any RFC 4122 version, including the v7 ids this schema generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The Board tab — the Kanban that used to be the whole project page.
 *
 * Reads the same rows as the List through the same query, with the Board
 * view's own settings on the request: its filters, its sort, and — grouped by
 * anything but section — one column per value rather than per section.
 */
export function ProjectBoardPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const me = useCurrentUser();
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;

  const { data: project, isLoading } = useProject(workspaceId, projectId);
  const { data: views } = useProjectViews(workspaceId, projectId);

  /*
   * The open panel and the open view live in the URL, not component state —
   * same contract as the List page: reload restores them, Copy link can copy
   * it, Back closes the panel. Re-validated because `useSearch({ strict:
   * false })` returns raw params.
   */
  const navigate = useNavigate();
  const routeSearch: Partial<{ task: string; comment: string; view: string; section: string }> =
    useSearch({ strict: false });
  const openTaskId =
    routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;
  const linkedCommentId =
    openTaskId && routeSearch.comment && UUID_PATTERN.test(routeSearch.comment)
      ? routeSearch.comment
      : null;
  const requestedViewId =
    routeSearch.view && UUID_PATTERN.test(routeSearch.view) ? routeSearch.view : undefined;
  // The selected section rides along too, so opening a task does not lose it.
  const selectedSectionId =
    routeSearch.section && UUID_PATTERN.test(routeSearch.section) ? routeSearch.section : null;
  const viewSearch = {
    ...(requestedViewId ? { view: requestedViewId } : {}),
    ...(selectedSectionId ? { section: selectedSectionId } : {}),
  };

  // Replace, as on the List: selecting a section is not a place Back returns from.
  const selectSection = (sectionId: string) =>
    void navigate({
      to: '/projects/$projectId/board',
      params: { projectId },
      search: { ...viewSearch, ...(openTaskId ? { task: openTaskId } : {}), section: sectionId },
      replace: true,
      resetScroll: false,
    });

  const boardView = useActiveView(views, ProjectViewType.BOARD, requestedViewId);
  const canPersist = canPersistView(boardView, me?.id, role);
  const editor = useViewSettingsEditor({ workspaceId, projectId, view: boardView, canPersist });
  const settings = editor.settings;
  const [savingAs, setSavingAs] = useState(false);
  const createView = useCreateProjectView(workspaceId, projectId);

  /*
   * The same query the List reads, so both views draw the same set.
   *
   * The Board used to read a task-only endpoint under its own cache key, which
   * is why a ticket filed from the List never appeared here and why creating on
   * the Board left the List stale. One query, one key, one answer.
   */
  const groupedByValue = Boolean(settings.groupBy) && settings.groupBy !== SystemField.SECTION;
  const {
    data: workItems,
    isError: tasksFailed,
    error: tasksError,
    refetch: refetchTasks,
  } = useProjectWorkItems(workspaceId, projectId, {
    includeCustomFields: true,
    ...(settings.filters.conditions.length > 0 ? { filters: settings.filters.conditions } : {}),
    ...(settings.sorts.length > 0 ? { sorts: settings.sorts } : {}),
    ...(groupedByValue ? { groupBy: settings.groupBy } : {}),
    ...(settings.showCompleted === false ? { showCompleted: false } : {}),
  });

  const tasks = useMemo(() => (workItems?.items ?? []).map(toWorkItemRow), [workItems]);
  const [composing, setComposing] = useState<CreatableWorkItemType | null>(null);

  // Tab+N, as on the List: the board has no add row, so it opens the form.
  useShortcutActions({
    newTask: project ? () => setComposing(project.defaultWorkItemType) : undefined,
  });

  // Push on open (Back closes), replace on swap and on close; `resetScroll:
  // false` keeps the router from jumping the page per open. See the List page.
  const openTask = (taskId: string) =>
    void navigate({
      to: '/projects/$projectId/board',
      params: { projectId },
      search: { ...viewSearch, task: taskId },
      replace: openTaskId !== null,
      resetScroll: false,
    });

  const closeTask = () =>
    void navigate({
      to: '/projects/$projectId/board',
      params: { projectId },
      search: viewSearch,
      replace: true,
      resetScroll: false,
    });

  const createWorkItem = useCreateProjectWorkItem(workspaceId, projectId);
  const createSection = useCreateSection(workspaceId, projectId);
  const [addingSection, setAddingSection] = useState(false);
  const { data: metadata } = useFieldMetadata(workspaceId, projectId);

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canManage = hasAtLeastRole(role, WorkspaceRole.MANAGER);
  const archived = Boolean(project?.archivedAt);
  const manualOrder = isManualOrder(settings);

  if (isLoading || !project) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      {/* The same controls the List carries, in the same place — see
          `view-toolbar-slot`. Both views offer one way to add to a project
          and the same four menus. */}
      <ViewToolbar>
        <div className="flex w-full flex-wrap items-center gap-2">
          <ProjectWorkItemCreateButton
            defaultType={project.defaultWorkItemType}
            context={{ projectId, sourceView: 'BOARD' }}
            pending={createWorkItem.isPending}
            onCreate={(type) => setComposing(type as CreatableWorkItemType)}
            onCreateSection={() => setAddingSection(true)}
          />
          <div className="ml-auto">
            <ViewToolbarControls
              viewType={ProjectViewType.BOARD}
              settings={settings}
              metadata={metadata}
              meId={me?.id}
              canPersist={canPersist}
              dirty={editor.dirty}
              onChange={editor.update}
              onSaveAs={() => setSavingAs(true)}
            />
          </div>
        </div>
      </ViewToolbar>

      {canEdit && (
        <p className="text-xs text-muted-foreground">
          {manualOrder
            ? 'Drag a column by its handle to reorder · click a name to rename'
            : 'Drag a card into another column to set its value · reordering is off while sorted or grouped'}
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

      {groupedByValue ? (
        <GroupedBoard
          workspaceId={workspaceId}
          projectId={project.id}
          tasks={tasks}
          settings={settings}
          metadata={metadata}
          canEdit={canEdit && !archived}
          onOpenTask={openTask}
        />
      ) : project.sections.length === 0 ? (
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
          manualOrder={manualOrder}
          cardFields={settings.cardFields ?? []}
          metadata={metadata}
          onOpenTask={openTask}
          onAddSection={() => setAddingSection(true)}
          selectedSectionId={selectedSectionId}
          onSelectSection={selectSection}
        />
      )}

      <SaveViewDialog
        open={savingAs}
        pending={createView.isPending}
        onOpenChange={setSavingAs}
        onSave={(name) =>
          createView.mutate(
            { name, type: ProjectViewType.BOARD, scope: 'PERSONAL', settings },
            {
              onSuccess: (created) => {
                setSavingAs(false);
                editor.revert();
                void navigate({
                  to: '/projects/$projectId/board',
                  params: { projectId },
                  search: { view: created.id },
                  replace: true,
                  resetScroll: false,
                });
              },
            },
          )
        }
      />

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
        linkedCommentId={linkedCommentId}
        role={role}
        projectId={projectId}
        onOpenTask={openTask}
        onClose={closeTask}
      />
    </div>
  );
}
