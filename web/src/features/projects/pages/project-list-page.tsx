import { ProjectViewType, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ViewColumn } from '@coretask/types';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { useCurrentUser } from '@/stores/auth.store';

import { ProjectListView } from '../components/project-list-view';
import { SaveViewDialog } from '../components/toolbar/save-view-dialog';
import {
  canPersistView,
  useActiveView,
  useCreateProjectView,
  useProjectViews,
  useViewSettingsEditor,
} from '../hooks/use-project-views';
import { TaskDetailPanel } from '@/features/tasks/components/task-detail-dialog';

/** Accepts any RFC 4122 version, including the v7 ids this schema generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The List tab.
 *
 * Everything the toolbar changes — columns, filters, sorts, grouping, density —
 * is held in the saved view, not in local state or localStorage: someone who
 * arranges a view on a laptop expects it on a second machine, and a shared
 * view has to look the same to everyone who opens it. The editor hook applies
 * a change at once and writes it a moment later; somebody who may not write
 * to this view keeps a draft and is offered "Save as my view" instead.
 */
export function ProjectListPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const me = useCurrentUser();

  const { data: views, isLoading } = useProjectViews(workspaceId, projectId);

  /*
   * The open panel and the open view live in the URL, not component state: a
   * reload restores them, the panel's Copy link can copy it, and Back closes
   * the panel. Re-validated here because `useSearch({ strict: false })`
   * returns the raw parameters — same rule as the tickets page.
   */
  const navigate = useNavigate();
  const routeSearch: Partial<{ task: string; comment: string; view: string }> = useSearch({
    strict: false,
  });
  const openTaskId =
    routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;
  const linkedCommentId =
    openTaskId && routeSearch.comment && UUID_PATTERN.test(routeSearch.comment)
      ? routeSearch.comment
      : null;
  const requestedViewId =
    routeSearch.view && UUID_PATTERN.test(routeSearch.view) ? routeSearch.view : undefined;

  const viewSearch = requestedViewId ? { view: requestedViewId } : {};

  /*
   * Opening pushes — Back closes the panel. Swapping tasks replaces, so Back
   * never replays a row-clicking spree: it always means "put the panel away".
   * `resetScroll: false` is load-bearing — the router restores scroll on
   * pushes by default, which would jump the list to the top per open.
   */
  const openTask = (taskId: string) =>
    void navigate({
      to: '/projects/$projectId/list',
      params: { projectId },
      search: { ...viewSearch, task: taskId },
      replace: openTaskId !== null,
      resetScroll: false,
    });

  const closeTask = () =>
    void navigate({
      to: '/projects/$projectId/list',
      params: { projectId },
      search: viewSearch,
      replace: true,
      resetScroll: false,
    });

  const listView = useActiveView(views, ProjectViewType.LIST, requestedViewId);
  const canPersist = canPersistView(listView, me?.id, role);
  const editor = useViewSettingsEditor({ workspaceId, projectId, view: listView, canPersist });

  const [savingAs, setSavingAs] = useState(false);
  const createView = useCreateProjectView(workspaceId, projectId);

  const onColumnsChange = (next: ViewColumn[]) => editor.update({ columns: next });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <ProjectListView
        workspaceId={workspaceId}
        projectId={projectId}
        canEdit={hasAtLeastRole(role, WorkspaceRole.MEMBER)}
        // Archiving hides work from everyone, so the bulk bar offers it to
        // the same people the task route does.
        canArchive={hasAtLeastRole(role, WorkspaceRole.MANAGER)}
        columns={editor.settings.columns}
        onColumnsChange={onColumnsChange}
        onOpenTask={openTask}
        settings={editor.settings}
        onSettingsChange={editor.update}
        canPersist={canPersist}
        dirty={editor.dirty}
        onSaveAs={() => setSavingAs(true)}
      />

      {/* A personal copy of the draft, for somebody who may not write to
          this view. It opens at `?view=<id>` so the link keeps it. */}
      <SaveViewDialog
        open={savingAs}
        pending={createView.isPending}
        onOpenChange={setSavingAs}
        onSave={(name) =>
          createView.mutate(
            { name, type: ProjectViewType.LIST, scope: 'PERSONAL', settings: editor.settings },
            {
              onSuccess: (created) => {
                setSavingAs(false);
                editor.revert();
                void navigate({
                  to: '/projects/$projectId/list',
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

      {/* The same task editor the board opens, slid in from the right the way
          the portfolio panel does — the list stays visible behind it. */}
      <TaskDetailPanel
        workspaceId={workspaceId}
        taskId={openTaskId}
        linkedCommentId={linkedCommentId}
        role={role}
        projectId={projectId}
        onOpenTask={openTask}
        onClose={closeTask}
      />
    </>
  );
}
