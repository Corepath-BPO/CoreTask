import { WorkspaceRole } from '@coretask/contracts';
import type { ApiKey } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeysPage } from './api-keys-page';

const WORKSPACE = '019fc880-0000-7000-8000-000000000000';
const ME = '019fc880-0000-7000-8000-00000000aaaa';

const listKeys = vi.fn();
const createKey = vi.fn();
const updateKey = vi.fn();
const revokeKey = vi.fn();
const writeText = vi.fn();

let activeRole: WorkspaceRole = WorkspaceRole.OWNER;

vi.mock('../api/api-keys.api', () => ({
  apiKeysApi: {
    list: (...args: unknown[]) => listKeys(...args),
    create: (...args: unknown[]) => createKey(...args),
    update: (...args: unknown[]) => updateKey(...args),
    revoke: (...args: unknown[]) => revokeKey(...args),
  },
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: WORKSPACE, name: 'Acme Product', role: activeRole },
    workspaces: [],
    isLoading: false,
    select: vi.fn(),
  }),
}));

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    workspaceId: WORKSPACE,
    name: 'n8n',
    prefix: 'ctk_AbCdEfGh',
    role: 'MEMBER',
    userId: 'svc-1',
    createdBy: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
    createdAt: '2026-09-01T00:00:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    expired: false,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return render(
    <QueryClientProvider client={client}>
      <ApiKeysPage />
    </QueryClientProvider>,
  );
}

describe('ApiKeysPage', () => {
  beforeEach(() => {
    listKeys.mockReset();
    createKey.mockReset();
    updateKey.mockReset();
    revokeKey.mockReset();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    activeRole = WorkspaceRole.OWNER;

    listKeys.mockResolvedValue([apiKey()]);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('lists keys with their prefix, role and use', async () => {
    renderPage();

    expect(await screen.findByText('n8n')).toBeInTheDocument();
    expect(screen.getByText('ctk_AbCdEfGh…')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(listKeys).toHaveBeenCalledWith(WORKSPACE);
  });

  it('marks revoked and expired keys and offers them no actions', async () => {
    listKeys.mockResolvedValue([
      apiKey({ id: 'k-revoked', name: 'old', revokedAt: '2026-09-02T00:00:00.000Z' }),
      apiKey({
        id: 'k-expired',
        name: 'stale',
        expiresAt: '2026-01-01T00:00:00.000Z',
        expired: true,
      }),
    ]);
    renderPage();

    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument();
  });

  /**
   * The API refuses the list for anyone below admin, so the page must not even
   * ask — a member deep-linking here sees nothing rather than an error toast.
   */
  it('renders nothing for a member and never requests the list', () => {
    activeRole = WorkspaceRole.MEMBER;
    const { container } = renderPage();

    expect(container).toBeEmptyDOMElement();
    expect(listKeys).not.toHaveBeenCalled();
  });

  it('creates a key, shows the secret once masked, and copies the raw value', async () => {
    const user = userEvent.setup();
    // `userEvent.setup()` installs its own clipboard stub, so the spy has to
    // go in after it or the click lands on the stub instead.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const secret = 'ctk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';
    createKey.mockResolvedValue({ key: apiKey({ id: 'key-2', name: 'Zapier' }), secret });
    renderPage();

    await screen.findByText('n8n');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/name/i), 'Zapier');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));

    await waitFor(() =>
      expect(createKey).toHaveBeenCalledWith(WORKSPACE, {
        name: 'Zapier',
        role: 'MEMBER',
        expiresInDays: null,
      }),
    );

    const revealed = await screen.findByLabelText('API key');
    expect(revealed).toHaveValue(secret);
    // Masked by default: keys get created while screen-sharing.
    expect(revealed).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(revealed).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Copy API key' }));
    expect(writeText).toHaveBeenCalledWith(secret);

    expect(screen.getByText(/won’t be shown again/i)).toBeInTheDocument();

    // Closing forgets the secret: reopening shows the form, not the key.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(within(screen.getByRole('dialog')).getByLabelText(/name/i)).toHaveValue('');
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  });

  it('asks before revoking, and only then calls the API', async () => {
    const user = userEvent.setup();
    revokeKey.mockResolvedValue(apiKey({ revokedAt: '2026-09-03T00:00:00.000Z' }));
    renderPage();

    await screen.findByText('n8n');
    await user.click(screen.getByRole('button', { name: 'Actions for n8n' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(revokeKey).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revokeKey).toHaveBeenCalledWith(WORKSPACE, 'key-1'));
  });

  it('shows the workspace id and base URL in the n8n help', async () => {
    renderPage();

    await screen.findByText('n8n');
    expect(screen.getByText(WORKSPACE)).toBeInTheDocument();
    expect(screen.getByText(/localhost:3000\/api\/v1$/)).toBeInTheDocument();
  });
});
