import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { AddToProjectPicker, OtherProjectRow } from './task-projects-field';

const add = vi.fn();
const remove = vi.fn();
const setSection = vi.fn();

vi.mock('../hooks/use-tasks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAddTaskToProject: () => ({ mutate: add, isPending: false }),
  useRemoveTaskFromProject: () => ({ mutate: remove, isPending: false }),
  useSetTaskProjectSection: () => ({ mutate: setSection, isPending: false }),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProject: () => ({
    data: {
      sections: [
        { id: 's-1', name: 'Backlog' },
        { id: 's-2', name: 'Review' },
      ],
    },
  }),
  useProjects: () => ({
    data: {
      items: [
        { id: 'home', name: 'Board pack', key: 'BRD', color: '#111111', archivedAt: null },
        { id: 'p-2', name: 'Leasing', key: 'LEA', color: '#6366f1', archivedAt: null },
        { id: 'p-3', name: 'Renewals', key: 'REN', color: '#22c55e', archivedAt: null },
        { id: 'old', name: 'Old', key: 'OLD', color: '#999999', archivedAt: '2026-01-01' },
      ],
    },
  }),
}));

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  add.mockReset();
  remove.mockReset();
  setSection.mockReset();
});

describe('OtherProjectRow', () => {
  it('shows the project with its own section there, and takes the task out', async () => {
    const user = setupUser();
    wrap(
      <OtherProjectRow
        workspaceId="ws-1"
        taskId="t-1"
        canEdit
        membership={{
          project: { id: 'p-2', name: 'Leasing', key: 'LEA', color: '#6366f1' },
          section: { id: 's-2', name: 'Review' },
        }}
      />,
    );

    expect(screen.getByText('Leasing')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Section in Leasing' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove from Leasing' }));
    expect(remove).toHaveBeenCalledWith({ taskId: 't-1', projectId: 'p-2' });
  });

  it('is read-only for someone who cannot edit', () => {
    wrap(
      <OtherProjectRow
        workspaceId="ws-1"
        taskId="t-1"
        canEdit={false}
        membership={{
          project: { id: 'p-2', name: 'Leasing', key: 'LEA', color: '#6366f1' },
          section: null,
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Remove from Leasing' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Section in Leasing' })).toBeDisabled();
  });
});

describe('AddToProjectPicker', () => {
  it('offers only the live projects the task is not in, and adds it to the chosen one', async () => {
    const user = setupUser();
    wrap(<AddToProjectPicker workspaceId="ws-1" taskId="t-1" excludeIds={['home', 'p-2']} />);

    await user.click(screen.getByRole('button', { name: /Add to project/ }));
    expect(await screen.findByRole('option', { name: /Renewals/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Leasing/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Board pack/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Old/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /Renewals/ }));
    expect(add).toHaveBeenCalledWith({ taskId: 't-1', projectId: 'p-3' });
  });
});
