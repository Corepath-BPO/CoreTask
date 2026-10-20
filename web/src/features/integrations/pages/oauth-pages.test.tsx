import type { ConnectedApp, OAuthApp } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { setupUser } from '@/test/test-utils';

import { ConnectedAppsPage } from './connected-apps-page';
import { OAuthAppsPage } from './oauth-apps-page';
import { OAuthConsentPage } from './oauth-consent-page';

const api = {
  apps: vi.fn(),
  createApp: vi.fn(),
  updateApp: vi.fn(),
  rotateSecret: vi.fn(),
  deleteApp: vi.fn(),
  connectedApps: vi.fn(),
  disconnect: vi.fn(),
  consent: vi.fn(),
  authorize: vi.fn(),
};

vi.mock('../api/oauth.api', () => ({
  oauthApi: new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        (...args: unknown[]) =>
          api[name as keyof typeof api](...args),
    },
  ),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (select: (state: { user: { email: string } }) => unknown) =>
    select({ user: { email: 'bea@example.com' } }),
}));

function app(overrides: Partial<OAuthApp> = {}): OAuthApp {
  return {
    id: 'app-1',
    name: 'Leasing sync',
    description: 'Keeps the CRM in step.',
    websiteUrl: null,
    redirectUris: ['https://tool.example/callback'],
    clientId: 'ctc_client',
    secretHint: 'cts_AbCdEf',
    connections: 2,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('OAuth apps', () => {
  it('lists an app with its client id, secret hint and redirect URIs', async () => {
    api.apps.mockResolvedValue([app()]);
    renderWith(<OAuthAppsPage />);

    expect(await screen.findByText('Leasing sync')).toBeInTheDocument();
    expect(screen.getByText('2 people connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Client id')).toHaveValue('ctc_client');
    expect(screen.getByText('cts_AbCdEf…')).toBeInTheDocument();
    expect(screen.getByText('https://tool.example/callback')).toBeInTheDocument();
  });

  it('registers an app, refusing a plain-http redirect, and shows the secret once', async () => {
    api.apps.mockResolvedValue([]);
    api.createApp.mockResolvedValue({ app: app(), clientSecret: 'cts_the_secret' });
    renderWith(<OAuthAppsPage />);
    const user = setupUser();

    await user.click(await screen.findByRole('button', { name: 'Register app' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/), 'Leasing sync');
    await user.type(within(dialog).getByLabelText(/Redirect URIs/), 'http://tool.example/cb');
    await user.click(within(dialog).getByRole('button', { name: 'Register app' }));
    expect(await within(dialog).findByText(/Use https:\/\//)).toBeInTheDocument();
    expect(api.createApp).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText(/Redirect URIs/));
    await user.type(
      within(dialog).getByLabelText(/Redirect URIs/),
      'https://tool.example/callback{enter}http://localhost:5678/cb',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Register app' }));

    await waitFor(() =>
      expect(api.createApp).toHaveBeenCalledWith({
        name: 'Leasing sync',
        description: null,
        websiteUrl: null,
        redirectUris: ['https://tool.example/callback', 'http://localhost:5678/cb'],
      }),
    );
    expect(await screen.findByLabelText('Client secret')).toHaveValue('cts_the_secret');
  });
});

describe('Connected apps', () => {
  const connected: ConnectedApp = {
    app: { id: 'app-1', name: 'Leasing sync', websiteUrl: null, publisher: 'Ada Owner' },
    scopes: ['default'],
    connectedAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    connections: 1,
  };

  it('disconnects an app after asking', async () => {
    api.connectedApps.mockResolvedValue([connected]);
    api.disconnect.mockResolvedValue(undefined);
    renderWith(<ConnectedAppsPage />);
    const user = setupUser();

    expect(await screen.findByText('Leasing sync')).toBeInTheDocument();
    expect(screen.getByText(/By Ada Owner/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }),
    );
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('app-1'));
  });
});

describe('the consent page', () => {
  const assign = vi.fn();
  const location = window.location;

  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...location,
        search:
          '?client_id=ctc_client&redirect_uri=https%3A%2F%2Ftool.example%2Fcallback&response_type=code&state=st-1',
        assign,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: location });
  });

  it('shows who is asking and sends the person on with the code', async () => {
    api.consent.mockResolvedValue({
      app: { name: 'Leasing sync', description: null, websiteUrl: null, publisher: 'Ada Owner' },
      scopes: [{ scope: 'default', description: 'See and change your tasks.' }],
      redirectHost: 'tool.example',
    });
    api.authorize.mockResolvedValue({
      redirectTo: 'https://tool.example/callback?code=c&state=st-1',
    });
    renderWith(<OAuthConsentPage />);
    const user = setupUser();

    expect(
      await screen.findByRole('heading', {
        name: 'Allow Leasing sync to use your CoreTask account?',
      }),
    ).toBeInTheDocument();
    expect(api.consent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'ctc_client',
        redirectUri: 'https://tool.example/callback',
        state: 'st-1',
      }),
    );
    expect(screen.getByText('tool.example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://tool.example/callback?code=c&state=st-1'),
    );
    expect(api.authorize).toHaveBeenCalledWith(expect.objectContaining({ approve: true }));
  });

  it('offers nothing to click when the request does not check out', async () => {
    api.consent.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'OAUTH_REDIRECT_URI_MISMATCH',
        message: 'The app asked to send you somewhere it did not register.',
      }),
    );
    renderWith(<OAuthConsentPage />);

    expect(await screen.findByText('This app can’t be connected')).toBeInTheDocument();
    expect(screen.getByText(/did not register/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });
});
