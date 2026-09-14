import { TaskPriority, TaskStatus, WorkItemType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ProjectWorkItem } from '@coretask/types';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toWorkItemRow } from '@/features/work-items/lib/work-item-row';
import { renderWithProviders } from '@/test/test-utils';

import { DEFAULT_VIEW_SETTINGS } from '../lib/view-settings';

import { GroupedBoard } from './grouped-board';

vi.mock('../hooks/use-projects', () => ({
  useProject: () => ({ data: { defaultWorkItemType: 'TASK' } }),
}));
vi.mock('../hooks/use-project-views', () => ({
  useSetCustomFieldValue: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/features/work-items/hooks/use-project-work-items', () => ({
  useCreateProjectWorkItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProjectWorkItem: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/features/tasks/hooks/use-tasks', () => ({
  useMoveTaskToSection: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/features/work-items/hooks/use-work-item-permissions', () => ({
  useWorkItemPermissions: () => ({
    canCreate: false,
    canCreateSection: false,
    creatableTypes: [WorkItemType.TASK],
    comingSoonTypes: [],
  }),
}));

const item = (id: string, status: { id: string; name: string } | null): ProjectWorkItem => ({
  id,
  type: WorkItemType.TASK,
  workspaceId: 'ws-1',
  projectId: 'p-1',
  sectionId: 's-1',
  parentId: null,
  title: `Task ${id}`,
  description: null,
  position: 1,
  status: status ? { ...status, colorToken: 'blue' } : null,
  priority: null,
  assignees: [],
  startDate: null,
  startAt: null,
  dueDate: null,
  dueAt: null,
  completedAt: null,
  archivedAt: null,
  subtaskCount: 0,
  completedSubtaskCount: 0,
  commentCount: 0,
  attachmentCount: 0,
  customFieldValues: [],
  details: {
    kind: 'TASK',
    estimatedMinutes: null,
    rawStatus: TaskStatus.TODO,
    rawPriority: TaskPriority.NONE,
  },
  createdById: 'u-1',
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const metadata: ProjectFieldMetadata = {
  customFields: [],
  statuses: [
    { id: 'st-todo', name: 'To do', category: 'TODO', colorToken: 'gray' },
    { id: 'st-doing', name: 'Doing', category: 'IN_PROGRESS', colorToken: 'blue' },
  ],
  priorities: [],
  sections: [{ id: 's-1', name: 'Backlog' }],
  members: [],
};

describe('GroupedBoard', () => {
  it('draws one column per status, empty ones included, and files each card by its value', () => {
    renderWithProviders(
      <GroupedBoard
        workspaceId="ws-1"
        projectId="p-1"
        tasks={[item('a', { id: 'st-doing', name: 'Doing' })].map(toWorkItemRow)}
        settings={{ ...DEFAULT_VIEW_SETTINGS, groupBy: 'status' }}
        metadata={metadata}
        canEdit
        onOpenTask={vi.fn()}
      />,
    );

    const todo = screen.getByRole('region', { name: 'To do' });
    const doing = screen.getByRole('region', { name: 'Doing' });
    expect(within(todo).queryByText('Task a')).not.toBeInTheDocument();
    expect(within(doing).getByText('Task a')).toBeInTheDocument();
    // A value column has nothing to rename and no rule to attach.
    expect(within(doing).queryByRole('button', { name: /rename/i })).not.toBeInTheDocument();
  });
});
