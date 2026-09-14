import { SystemField, WorkItemType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ProjectWorkItem } from '@coretask/types';
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { ProjectListView } from './project-list-view';

const mocks = vi.hoisted(() => {
  const item = (id: string, title: string): Record<string, unknown> => ({
    id,
    type: 'TASK',
    workspaceId: 'ws-1',
    projectId: 'p-1',
    sectionId: 's-1',
    parentId: null,
    title,
    description: null,
    position: Number(id.slice(-1)),
    status: { id: 'TODO', name: 'To do', colorToken: 'slate' },
    priority: { id: 'MEDIUM', name: 'Medium', colorToken: 'amber' },
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
    details: { kind: 'TASK', estimatedMinutes: null, rawStatus: 'TODO', rawPriority: 'MEDIUM' },
    createdById: 'u-1',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  return {
    items: [item('t-1', 'One'), item('t-2', 'Two'), item('t-3', 'Three')],
    bulkMutate: vi.fn(),
    updateMutate: vi.fn(),
  };
});

const metadata: ProjectFieldMetadata = {
  customFields: [],
  statuses: [],
  priorities: [],
  sections: [
    { id: 's-1', name: 'To do' },
    { id: 's-2', name: 'Doing' },
  ],
  members: [{ id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: null }],
};

vi.mock('@/features/work-items/hooks/use-project-work-items', () => ({
  useProjectWorkItems: () => ({
    data: { items: mocks.items as unknown as ProjectWorkItem[], nextCursor: null },
    isLoading: false,
    isError: false,
  }),
  useCreateProjectWorkItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProjectWorkItem: () => ({ mutate: mocks.updateMutate, isPending: false }),
  useBulkUpdateWorkItems: () => ({ mutate: mocks.bulkMutate, isPending: false }),
}));
vi.mock('../hooks/use-project-views', () => ({
  useFieldMetadata: () => ({ data: metadata }),
  useSetCustomFieldValue: () => ({ mutate: vi.fn() }),
  useSubtasks: () => ({ data: undefined, isLoading: false, isError: false }),
  useFieldCatalog: () => ({ data: undefined, isLoading: false }),
  useAttachField: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/use-projects', () => ({
  useProject: () => ({ data: undefined }),
  useCreateSection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRenameSection: () => ({ mutate: vi.fn() }),
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
vi.mock('@/features/automations/components/section-automation-popover', () => ({
  SectionAutomationPopover: () => null,
}));

const rowOf = (title: string) =>
  screen.getByRole('button', { name: `Open "${title}"` }).closest('tr') as HTMLTableRowElement;

function renderList(props: Partial<React.ComponentProps<typeof ProjectListView>> = {}) {
  const onOpenTask = vi.fn();
  renderWithProviders(
    <ProjectListView
      workspaceId="ws-1"
      projectId="p-1"
      canEdit
      canArchive
      columns={[{ field: SystemField.TITLE, width: 320 }, { field: SystemField.ASSIGNEE }]}
      onColumnsChange={vi.fn()}
      onOpenTask={onOpenTask}
      {...props}
    />,
  );
  return { onOpenTask };
}

describe('ProjectListView multi-select', { timeout: 15_000 }, () => {
  beforeEach(() => {
    mocks.bulkMutate.mockReset();
  });

  it('selects on a row click, extends with shift and toggles with ctrl', () => {
    renderList();

    fireEvent.click(rowOf('One'));
    expect(rowOf('One')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('1 selected');

    fireEvent.click(rowOf('Three'), { shiftKey: true });
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('3 selected');

    fireEvent.click(rowOf('Two'), { ctrlKey: true });
    expect(rowOf('Two')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('2 selected');
  });

  it('leaves a click on the title to the title, which opens the task', () => {
    const { onOpenTask } = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Open "One"' }));

    expect(onOpenTask).toHaveBeenCalledWith('t-1');
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('clears on Escape and never selects when the view is read-only', () => {
    renderList();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select "Two"' }));
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('offers nothing to select when the view is read-only', () => {
    renderList({ canEdit: false });

    expect(screen.queryByRole('checkbox', { name: /^Select/ })).not.toBeInTheDocument();
    fireEvent.click(rowOf('One'));
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('sends one bulk request for the selection and clears it once that lands', async () => {
    renderList();

    fireEvent.click(rowOf('One'));
    fireEvent.click(rowOf('Two'), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Due date' }));

    const day = new Intl.DateTimeFormat('en', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date());
    fireEvent.click(await screen.findByRole('button', { name: day }));

    expect(mocks.bulkMutate).toHaveBeenCalledTimes(1);
    const [payload, options] = mocks.bulkMutate.mock.calls[0] as [
      { workItemIds: string[]; update: { dueDate: string; dueAt: null } },
      { onSuccess: () => void },
    ];
    expect(payload.workItemIds).toEqual(['t-1', 't-2']);
    expect(payload.update.dueAt).toBeNull();
    expect(payload.update.dueDate).toMatch(/T00:00:00\.000Z$/);

    act(() => options.onSuccess());
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });
});
