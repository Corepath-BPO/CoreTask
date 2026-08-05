import {
  CREATABLE_WORK_ITEM_TYPES,
  WorkItemType,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { useMemo } from 'react';

import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

export interface WorkItemPermissions {
  /** Whether anything at all may be created here. */
  canCreate: boolean;
  canCreateSection: boolean;
  /** The types this person may create, in menu order. Empty when none. */
  creatableTypes: WorkItemType[];
  /** Declared but not buildable — shown disabled rather than hidden. */
  comingSoonTypes: WorkItemType[];
}

/**
 * What this person may add to this project.
 *
 * Two different reasons a menu entry is unavailable, kept apart on purpose:
 *
 *   * **not permitted** — a guest cannot create anything, so the control is not
 *     offered at all. Showing a disabled button invites somebody to keep
 *     clicking it and wonder what is broken.
 *   * **not built** — Milestone and Approval have no model behind them, so they
 *     are shown disabled and labelled. Hiding them would make "coming" and
 *     "never considered" look identical, and offering them would create a task
 *     wearing a milestone's label.
 *
 * This decides presentation only. The API checks the same things again, because
 * a hidden menu item is not a permission check — see the work-items controller.
 */
export function useWorkItemPermissions(archived = false): WorkItemPermissions {
  const { workspace } = useActiveWorkspace();
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;

  return useMemo(() => {
    const canEdit = !archived && hasAtLeastRole(role, WorkspaceRole.MEMBER);

    return {
      canCreate: canEdit,
      // A section changes the shape of the project for everybody in it, which
      // is a manager's call rather than an ordinary edit.
      canCreateSection: !archived && hasAtLeastRole(role, WorkspaceRole.MANAGER),
      creatableTypes: canEdit ? [...CREATABLE_WORK_ITEM_TYPES] : [],
      comingSoonTypes: canEdit
        ? Object.values(WorkItemType).filter((type) => !CREATABLE_WORK_ITEM_TYPES.includes(type))
        : [],
    };
  }, [role, archived]);
}
