import type { ProjectSummary, StatusTemplate } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusUpdateComposer } from './status-update-composer';

const post = vi.fn();
const templates = vi.fn();

vi.mock('@/features/workspaces/hooks/use-workspaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1' } }),
}));

vi.mock('@/features/projects/hooks/use-project-updates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePostStatusUpdate: () => ({ mutate: post, isPending: false }),
  useProjectStatusUpdate: () => undefined,
}));

vi.mock('@/features/projects/hooks/use-project-members', () => ({
  useProjectMembers: () => ({ data: [] }),
}));

vi.mock('@/features/projects/hooks/use-status-templates', () => ({
  useStatusTemplates: (...args: unknown[]) => templates(...args),
}));

const project = {
  id: 'p-1',
  name: 'Leasing',
  color: '#6366f1',
  taskCount: 4,
  completedTaskCount: 1,
  sectionCount: 2,
  startDate: null,
  dueDate: null,
  archivedAt: null,
  lead: null,
} as unknown as ProjectSummary;

const weekly: StatusTemplate = {
  id: 'st-1',
  projectId: 'p-1',
  name: 'Weekly update',
  status: 'AT_RISK',
  summary: 'What we finished:\n- ',
  nextSteps: 'Plan the next sprint',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const renderComposer = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StatusUpdateComposer project={project} initialStatus="on_track" onClose={vi.fn()} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  post.mockReset();
  templates.mockReturnValue({ data: [weekly] });
});

describe('StatusUpdateComposer', () => {
  it('fills the status and both sections from a template, and posts what it filled', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByPlaceholderText("How's this project going?"), 'Old draft');
    await user.click(screen.getByRole('button', { name: /Use a template/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Weekly update' }));

    expect(screen.getByPlaceholderText("How's this project going?")).toHaveValue(
      'What we finished:\n- ',
    );
    expect(screen.getByPlaceholderText("What's next for the team?")).toHaveValue(
      'Plan the next sprint',
    );

    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'at_risk',
        note: 'What we finished:\n-',
        nextSteps: 'Plan the next sprint',
      }),
      expect.anything(),
    );
  });

  it('says where templates come from when the project has none', async () => {
    const user = userEvent.setup();
    templates.mockReturnValue({ data: [] });
    renderComposer();

    await user.click(screen.getByRole('button', { name: /Use a template/ }));
    expect(await screen.findByText(/Customize › Status templates/)).toBeInTheDocument();
  });
});
