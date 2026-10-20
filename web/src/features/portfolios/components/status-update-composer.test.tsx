import type { ProjectStatusDraft, ProjectSummary, StatusTemplate } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { paste, setupUser } from '@/test/test-utils';

import { StatusUpdateComposer } from './status-update-composer';

const post = vi.fn();
const discard = vi.fn();
const templates = vi.fn();

vi.mock('@/features/workspaces/hooks/use-workspaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1' } }),
}));

vi.mock('@/features/projects/hooks/use-project-updates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePostStatusUpdate: () => ({ mutate: post, isPending: false }),
  useDiscardStatusDraft: () => ({ mutate: discard, isPending: false }),
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
  discard.mockReset();
  templates.mockReturnValue({ data: [weekly] });
});

describe('StatusUpdateComposer', () => {
  it('fills the status and both sections from a template, and posts what it filled', async () => {
    const user = setupUser();
    renderComposer();

    // Pasted, not typed: typing re-renders the composer per keystroke, which
    // pushed this journey toward the timeout under the full parallel suite.
    await paste(user, screen.getByPlaceholderText("How's this project going?"), 'Old draft');
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
    const user = setupUser();
    templates.mockReturnValue({ data: [] });
    renderComposer();

    await user.click(screen.getByRole('button', { name: /Use a template/ }));
    expect(await screen.findByText(/Customize › Status templates/)).toBeInTheDocument();
  });

  describe('opened on a draft a rule’s AI step wrote', () => {
    const draft: ProjectStatusDraft = {
      id: 'd-1',
      projectId: 'p-1',
      status: 'AT_RISK',
      title: 'Heating repair is holding up 4B',
      summary: 'The renewal waits on the repair.',
      nextSteps: 'Book the repair.',
      rule: { id: 'r-1', name: 'Friday update' },
      createdAt: new Date().toISOString(),
    };
    const onClose = vi.fn();
    const renderDraft = () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <StatusUpdateComposer
            project={project}
            initialStatus="at_risk"
            draft={draft}
            onClose={onClose}
          />
        </QueryClientProvider>,
      );

    it('starts on its words, says where they came from, and posts what is on screen', async () => {
      const user = userEvent.setup();
      renderDraft();

      expect(screen.getByRole('note')).toHaveTextContent(
        'Drafted by AI for the rule “Friday update”',
      );
      expect(screen.getByLabelText('Update title')).toHaveValue('Heating repair is holding up 4B');
      expect(screen.getByPlaceholderText("How's this project going?")).toHaveValue(
        'The renewal waits on the repair.',
      );

      await user.click(screen.getByRole('button', { name: 'Post' }));
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'at_risk',
          title: 'Heating repair is holding up 4B',
          nextSteps: 'Book the repair.',
        }),
        expect.anything(),
      );
    });

    it('can throw the draft away instead', async () => {
      const user = userEvent.setup();
      renderDraft();

      await user.click(screen.getByRole('button', { name: 'Discard draft' }));
      expect(discard).toHaveBeenCalled();
    });
  });
});
