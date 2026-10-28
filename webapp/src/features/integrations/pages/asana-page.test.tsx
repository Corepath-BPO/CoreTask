import type { AsanaImportStatus, ImportRun } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { AsanaPage } from './asana-page';

const start = vi.fn();
const select = vi.fn();
const navigate = vi.fn();
let status: AsanaImportStatus;

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Acme' }, isLoading: false, select }),
}));

vi.mock('../hooks/use-asana-import', () => ({
  useAsanaImportStatus: () => ({ data: status, isLoading: false }),
  useStartAsanaImport: () => ({ mutate: start, isPending: false }),
}));

const base: AsanaImportStatus = {
  configured: true,
  missing: [],
  asanaWorkspace: { gid: '100', name: 'texasrenters.com' },
  eligible: true,
  reason: null,
  target: null,
  isTarget: false,
  runs: [],
};

const run: ImportRun = {
  id: 'run-1',
  workspaceId: 'ws-1',
  status: 'RUNNING',
  phase: 'subtasks',
  counts: {
    projects: { done: 60, total: 60 },
    tasks: { done: 3643, total: 3643 },
    subtasks: { done: 1200, total: 117660 },
    comments: { done: 12 },
    placeholders: { done: 22 },
    archived: { done: 3 },
    requests: 4321,
  },
  errors: [
    { kind: 'attachment', externalId: 'A1', name: 'scan.heic', message: 'Not an accepted type' },
  ],
  errorCount: 1,
  startedBy: { id: 'u-1', name: 'Ernie' },
  startedAt: '2026-10-27T12:00:00Z',
  finishedAt: null,
  createdAt: '2026-10-27T12:00:00Z',
};

beforeEach(() => {
  for (const mock of [start, select, navigate]) mock.mockReset();
  status = base;
});

describe('AsanaPage', () => {
  it('names the missing settings when the server has no token', () => {
    status = { ...base, configured: false, missing: ['ASANA_ACCESS_TOKEN'], asanaWorkspace: null };
    render(<AsanaPage />);
    expect(screen.getByText('Asana is not set up on this server')).toBeInTheDocument();
    expect(screen.getByText(/adds ASANA_ACCESS_TOKEN to the server/)).toBeInTheDocument();
  });

  it('says why someone outside the Asana workspace cannot import', () => {
    status = { ...base, eligible: false, reason: 'Your e-mail is not among its members.' };
    render(<AsanaPage />);
    expect(screen.getByText('You can’t import from Asana')).toBeInTheDocument();
    expect(screen.getByText('Your e-mail is not among its members.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import from Asana/ })).not.toBeInTheDocument();
  });

  it('imports into a new workspace once confirmed', async () => {
    const user = setupUser();
    render(<AsanaPage />);
    expect(screen.getByText('Import texasrenters.com into a new workspace')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Import from Asana/ }));
    expect(
      screen.getByText(/Nobody is notified, and no rules run on imported tasks/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('sends people to the workspace that holds the import', async () => {
    status = { ...base, target: { id: 'ws-2', name: 'texasrenters.com (Asana)', slug: 'tr' } };
    const user = setupUser();
    render(<AsanaPage />);

    await user.click(screen.getByRole('button', { name: 'Open texasrenters.com (Asana)' }));
    expect(select).toHaveBeenCalledWith('ws-2');
    expect(navigate).toHaveBeenCalledWith({ to: '/integrations/asana' });
  });

  it('shows a running sync with its progress and what did not come across', () => {
    status = {
      ...base,
      target: { id: 'ws-1', name: 'Acme', slug: 'acme' },
      isTarget: true,
      runs: [run],
    };
    render(<AsanaPage />);

    expect(screen.getByRole('button', { name: /Sync again/ })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Subtasks: 1%' })).toBeInTheDocument();
    expect(screen.getByText(/1,200 of 117,660/)).toBeInTheDocument();
    expect(screen.getByText(/4,321 Asana requests/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /22 new placeholder accounts · 12 comments · 3 tasks deleted in Asana, archived/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('1 record not imported')).toBeInTheDocument();
    expect(screen.getByText(/scan.heic: Not an accepted type/)).toBeInTheDocument();
  });
});
