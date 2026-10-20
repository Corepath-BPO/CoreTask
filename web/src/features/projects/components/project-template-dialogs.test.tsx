import type { ProjectSummary, ProjectTemplate } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { DuplicateProjectDialog, UseTemplateDialog } from './project-template-dialogs';

const duplicate = vi.fn();
const start = vi.fn();
const navigate = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}));

const template: ProjectTemplate = {
  id: 'tpl-1',
  name: 'Lease renewal',
  description: null,
  color: '#6366f1',
  parts: ['TASKS', 'DATES'],
  sectionCount: 4,
  taskCount: 3,
  ruleCount: 1,
  fieldCount: 0,
  createdBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

vi.mock('../hooks/use-project-templates', () => ({
  useDuplicateProject: () => ({ mutate: duplicate, isPending: false }),
  useStartFromTemplate: () => ({ mutate: start, isPending: false }),
  useDeleteProjectTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveProjectTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useProjectTemplates: () => ({ data: [template], isLoading: false }),
}));

const project = {
  id: 'p-1',
  name: 'Leasing',
  startDate: '2026-11-02T00:00:00.000Z',
  description: null,
} as unknown as ProjectSummary;

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  duplicate.mockReset();
  start.mockReset();
  navigate.mockReset();
});

describe('DuplicateProjectDialog', () => {
  it('takes everything by default, and drops what needs the tasks when they go', async () => {
    const user = setupUser();
    wrap(
      <DuplicateProjectDialog workspaceId="ws-1" project={project} open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Duplicate of Leasing');
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-11-02');

    await user.click(screen.getByRole('checkbox', { name: 'Tasks' }));
    expect(screen.getByRole('checkbox', { name: 'Subtasks' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Assignees' })).not.toBeChecked();
    // No dates without tasks, so no start date to ask for.
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(duplicate).toHaveBeenCalledWith(
      {
        projectId: 'p-1',
        payload: {
          name: 'Duplicate of Leasing',
          parts: ['FIELDS', 'RULES', 'TASK_TEMPLATES', 'MEMBERS'],
        },
      },
      expect.anything(),
    );
  });
});

describe('UseTemplateDialog', () => {
  it('starts a project from the chosen template, on the day given, and opens it', async () => {
    const user = setupUser();
    start.mockImplementation((_vars, options: { onSuccess: (value: unknown) => void }) =>
      options.onSuccess({ projectId: 'new-1', rulesNeedingAttention: [], rulesSkipped: 0 }),
    );
    wrap(<UseTemplateDialog workspaceId="ws-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByText('4 sections · 3 tasks · 1 rule')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Lease renewal/ }));
    expect(screen.getByLabelText('Project name')).toHaveValue('Lease renewal');

    await user.clear(screen.getByLabelText('Project name'));
    await user.type(screen.getByLabelText('Project name'), '12 Elm St');
    await user.clear(screen.getByLabelText('Start date'));
    await user.type(screen.getByLabelText('Start date'), '2027-01-04');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(start).toHaveBeenCalledWith(
      { templateId: 'tpl-1', payload: { name: '12 Elm St', startDate: '2027-01-04' } },
      expect.anything(),
    );
    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/list',
      params: { projectId: 'new-1' },
    });
  });
});
