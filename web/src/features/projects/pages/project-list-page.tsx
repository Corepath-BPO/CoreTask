import { ProjectViewType, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ViewColumn } from '@coretask/types';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { ProjectListView } from '../components/project-list-view';
import { useProjectViews, useSaveViewSettings } from '../hooks/use-project-views';
import { TaskDetailPanel } from '@/features/tasks/components/task-detail-dialog';

/** Accepts any RFC 4122 version, including the v7 ids this schema generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The List tab.
 *
 * Column choices are held in the saved view, not in local state or
 * localStorage: someone who arranges a view on a laptop expects it on a second
 * machine, and a shared view has to look the same to everyone who opens it.
 */
export function ProjectListPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;

  const { data: views, isLoading } = useProjectViews(workspaceId, projectId);
  const saveSettings = useSaveViewSettings(workspaceId, projectId);

  /*
   * The open panel lives in the URL, not component state: a reload restores
   * it, the panel's Copy link can copy it, and Back closes it. Re-validated
   * here because `useSearch({ strict: false })` returns the raw parameters —
   * same rule as the tickets page.
   */
  const navigate = useNavigate();
  const routeSearch: Partial<{ task: string }> = useSearch({ strict: false });
  const openTaskId =
    routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;

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
      search: { task: taskId },
      replace: openTaskId !== null,
      resetScroll: false,
    });

  const closeTask = () =>
    void navigate({
      to: '/projects/$projectId/list',
      params: { projectId },
      search: {},
      replace: true,
      resetScroll: false,
    });

  const listView = views?.find((view) => view.type === ProjectViewType.LIST);

  /*
   * Applied locally as well as saved, so reordering a column is immediate
   * rather than waiting on a round trip. The server remains the record — a
   * failed save surfaces as a toast and the next load shows what was actually
   * stored.
   */
  const [pendingColumns, setPendingColumns] = useState<ViewColumn[] | null>(null);
  const columns = pendingColumns ?? listView?.settings.columns ?? [];

  const onColumnsChange = (next: ViewColumn[]) => {
    setPendingColumns(next);
    if (listView) saveSettings(listView.id, { ...listView.settings, columns: next });
  };

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
        columns={columns}
        onColumnsChange={onColumnsChange}
        onOpenTask={openTask}
      />

      {/* The same task editor the board opens, slid in from the right the way
          the portfolio panel does — the list stays visible behind it. */}
      <TaskDetailPanel
        workspaceId={workspaceId}
        taskId={openTaskId}
        role={role}
        projectId={projectId}
        onOpenTask={openTask}
        onClose={closeTask}
      />
    </>
  );
}
