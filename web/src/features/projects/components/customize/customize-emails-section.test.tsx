import type { ProjectEmailSettings } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomizeEmailsSection } from './customize-emails-section';

const update = vi.fn();
const reset = vi.fn();
const navigate = vi.fn();
let settings: ProjectEmailSettings;

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

vi.mock('../../hooks/use-project-email', () => ({
  useProjectEmail: () => ({ data: settings, isLoading: false }),
  useUpdateProjectEmail: () => ({ mutate: update, isPending: false }),
  useResetProjectEmail: () => ({ mutate: reset, isPending: false }),
}));

vi.mock('../../hooks/use-projects', () => ({
  useProject: () => ({
    data: {
      sections: [
        { id: 's-1', name: 'Backlog' },
        { id: 's-2', name: 'Requests' },
      ],
    },
  }),
}));

const renderSection = (canEdit = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomizeEmailsSection workspaceId="ws-1" projectId="p-1" canEdit={canEdit} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  update.mockReset();
  reset.mockReset();
  navigate.mockReset();
  settings = {
    address: '0123456789abcdef0123@in.example.org',
    receiving: true,
    isActive: true,
    sectionId: null,
    acceptFrom: 'MEMBERS',
    addCollaborators: true,
    sendUpdates: true,
    receivedCount: 2,
    recent: [
      {
        id: 'r-2',
        fromAddress: 'someone@example.org',
        subject: 'Hello',
        outcome: 'REJECTED',
        reason: 'Only members of the workspace can email this project.',
        taskId: null,
        receivedAt: new Date().toISOString(),
      },
      {
        id: 'r-1',
        fromAddress: 'bea@example.org',
        subject: 'Leak in 4B',
        outcome: 'TASK_CREATED',
        reason: null,
        taskId: 't-1',
        receivedAt: new Date().toISOString(),
      },
    ],
  };
});

describe('CustomizeEmailsSection', () => {
  it('shows the address to copy, and Asana’s two checkboxes', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByLabelText('Project email address')).toHaveValue(
      '0123456789abcdef0123@in.example.org',
    );
    expect(screen.getByRole('button', { name: /Copy the project’s email address/ })).toBeEnabled();

    await user.click(
      screen.getByRole('checkbox', { name: 'Send recipients task updates automatically' }),
    );
    expect(update).toHaveBeenLastCalledWith({ sendUpdates: false });
    await user.click(screen.getByRole('checkbox', { name: 'Add members as task collaborators' }));
    expect(update).toHaveBeenLastCalledWith({ addCollaborators: false });
    await user.click(screen.getByRole('switch', { name: 'Take email at this address' }));
    expect(update).toHaveBeenLastCalledWith({ isActive: false });
  });

  it('lists what arrived, why mail was turned away, and opens the task it made', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText('2 received')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(
      within(list).getByText('Only members of the workspace can email this project.'),
    ).toBeInTheDocument();
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Open the task from “Leak in 4B”' }));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p-1' }, search: { task: 't-1' } }),
    );
  });

  it('asks before giving the project a new address', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Get a new address' }));
    expect(reset).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Get a new address' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('says how to turn email on when the server receives none', () => {
    settings = { ...settings, address: null, receiving: false };
    renderSection();

    expect(screen.queryByLabelText('Project email address')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('INBOUND_EMAIL_DOMAIN');
  });

  it('sends people who cannot edit to an editor', () => {
    renderSection(false);
    expect(screen.getByText(/Ask a project editor for the address/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
