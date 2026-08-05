import { ProjectViewType, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ViewColumn } from '@coretask/types';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { ProjectListView } from '../components/project-list-view';
import { useProjectViews, useSaveViewSettings } from '../hooks/use-project-views';
import { TaskDetailDialog } from '@/features/tasks/components/task-detail-dialog';

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
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

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
        onOpenTask={setOpenTaskId}
      />

      {/* The same dialog the board opens. One task editor, reached from
          wherever a task is shown. */}
      <TaskDetailDialog
        workspaceId={workspaceId}
        taskId={openTaskId}
        role={role}
        onClose={() => setOpenTaskId(null)}
      />
    </>
  );
}
