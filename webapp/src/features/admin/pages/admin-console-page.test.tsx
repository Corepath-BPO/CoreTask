import { WorkspaceRole } from '@coretask/contracts';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminConsolePage } from './admin-console-page';

let role: WorkspaceRole = WorkspaceRole.SUPER_ADMIN;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Navigate: () => null,
  Outlet: () => <div>tab content</div>,
  useLocation: () => ({ pathname: '/admin/members' }),
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Acme', role }, isLoading: false }),
}));

beforeEach(() => {
  role = WorkspaceRole.SUPER_ADMIN;
});

describe('AdminConsolePage', () => {
  it.each([WorkspaceRole.OWNER, WorkspaceRole.SUPER_ADMIN])('opens to a workspace %s', (value) => {
    role = value;
    render(<AdminConsolePage />);

    expect(screen.getByRole('heading', { name: 'Admin console' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('tab content')).toBeInTheDocument();
  });

  /** An admin who deep-links here never mounts a tab, so no query is refused. */
  it('stops an admin at the door', () => {
    role = WorkspaceRole.ADMIN;
    render(<AdminConsolePage />);

    expect(screen.getByText('Super admins only')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('tab content')).toBeNull();
  });

  it('says which tabs are still to come', () => {
    render(<AdminConsolePage />);

    expect(screen.getByRole('tab', { name: /Audit log/ })).toHaveTextContent('Soon');
    expect(screen.getByRole('tab', { name: 'Teams' })).not.toHaveTextContent('Soon');
  });
});
