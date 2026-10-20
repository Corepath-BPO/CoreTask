import type { SamlConnection, WorkspaceDomain } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, setupUser, waitFor, within } from '@/test/test-utils';

import { WorkspaceSsoCard } from './workspace-sso-card';

const api = {
  samlConnection: vi.fn(),
  saveSamlConnection: vi.fn(),
  deleteSamlConnection: vi.fn(),
  linkSaml: vi.fn(),
  domains: vi.fn(),
  addDomain: vi.fn(),
  removeDomain: vi.fn(),
  verifyDomain: vi.fn(),
};

vi.mock('@/features/auth/api/sso.api', () => ({
  ssoApi: {
    samlConnection: (...args: unknown[]) => api.samlConnection(...args),
    saveSamlConnection: (...args: unknown[]) => api.saveSamlConnection(...args),
    deleteSamlConnection: (...args: unknown[]) => api.deleteSamlConnection(...args),
    linkSaml: (...args: unknown[]) => api.linkSaml(...args),
    domains: (...args: unknown[]) => api.domains(...args),
    addDomain: (...args: unknown[]) => api.addDomain(...args),
    removeDomain: (...args: unknown[]) => api.removeDomain(...args),
    verifyDomain: (...args: unknown[]) => api.verifyDomain(...args),
  },
}));

vi.mock('@/features/auth/lib/leave-for', () => ({ leaveFor: vi.fn() }));

const API = 'https://api.coretask.test/api/v1/auth/sso/saml/c-1';
const CERTIFICATE = `-----BEGIN CERTIFICATE-----\n${'MIIC'.padEnd(120, 'A')}\n-----END CERTIFICATE-----\n`;

const connection = (over: Partial<SamlConnection> = {}): SamlConnection => ({
  id: 'c-1',
  enabled: false,
  idpEntityId: 'http://www.okta.com/exk1',
  idpSsoUrl: 'https://acme.okta.com/app/sso/saml',
  idpCertificate: CERTIFICATE,
  serviceProvider: {
    entityId: `${API}/metadata`,
    acsUrl: `${API}/acs`,
    metadataUrl: `${API}/metadata`,
  },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const domain = (over: Partial<WorkspaceDomain> = {}): WorkspaceDomain => ({
  id: 'd-1',
  domain: 'acme.com',
  verified: false,
  verifiedAt: null,
  txtRecord: 'coretask-verification=0123456789abcdef0123456789abcdef',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  api.domains.mockResolvedValue([]);
});

describe('WorkspaceSsoCard', () => {
  it('is only for admins and owners', () => {
    const { container } = renderWithProviders(<WorkspaceSsoCard workspaceId="w-1" role="MEMBER" />);
    expect(container).toBeEmptyDOMElement();
    expect(api.samlConnection).not.toHaveBeenCalled();
  });

  it('saves an empty draft, switched off, to get the addresses to give the provider', async () => {
    api.samlConnection.mockResolvedValue(null);
    api.saveSamlConnection.mockResolvedValue(
      connection({ idpEntityId: '', idpSsoUrl: '', idpCertificate: '' }),
    );
    const user = setupUser();
    renderWithProviders(<WorkspaceSsoCard workspaceId="w-1" role="ADMIN" />);

    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get CoreTask’s addresses' }));

    expect(api.saveSamlConnection).toHaveBeenCalledWith('w-1', {
      idpEntityId: '',
      idpSsoUrl: '',
      idpCertificate: '',
      enabled: false,
    });
    expect(await screen.findByLabelText('ACS URL (reply URL)')).toHaveValue(`${API}/acs`);
    expect(screen.getByLabelText('Entity ID (audience)')).toHaveValue(`${API}/metadata`);
    expect(screen.getByRole('button', { name: 'Copy ACS URL (reply URL)' })).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('turns it on only with every detail filled in', async () => {
    api.samlConnection.mockResolvedValue(connection());
    api.saveSamlConnection.mockResolvedValue(connection({ enabled: true }));
    const user = setupUser();
    renderWithProviders(<WorkspaceSsoCard workspaceId="w-1" role="OWNER" />);

    const certificate = await screen.findByLabelText('Signing certificate');
    expect(screen.getByLabelText('Identity provider entity ID')).toHaveValue(
      'http://www.okta.com/exk1',
    );
    await user.clear(certificate);
    await user.click(screen.getByRole('switch', { name: 'Let people sign in with it' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Paste the identity provider’s signing certificate.'),
    ).toBeInTheDocument();
    expect(api.saveSamlConnection).not.toHaveBeenCalled();

    await user.click(certificate);
    await user.paste(CERTIFICATE);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.saveSamlConnection).toHaveBeenCalledWith('w-1', {
        idpEntityId: 'http://www.okta.com/exk1',
        idpSsoUrl: 'https://acme.okta.com/app/sso/saml',
        idpCertificate: CERTIFICATE.trim(),
        enabled: true,
      }),
    );
    expect(await screen.findByText('On')).toBeInTheDocument();
  });

  it('shows the TXT record for an unverified domain, and checks it on request', async () => {
    api.samlConnection.mockResolvedValue(connection({ enabled: true }));
    api.domains.mockResolvedValue([
      domain(),
      domain({ id: 'd-2', domain: 'acme.io', verified: true, verifiedAt: '2026-10-02T00:00:00Z' }),
    ]);
    api.verifyDomain.mockResolvedValue(
      domain({ verified: true, verifiedAt: '2026-10-03T00:00:00Z' }),
    );
    const user = setupUser();
    renderWithProviders(<WorkspaceSsoCard workspaceId="w-1" role="ADMIN" />);

    const record = await screen.findByLabelText('TXT record for acme.com');
    expect(record).toHaveValue('coretask-verification=0123456789abcdef0123456789abcdef');
    expect(screen.queryByLabelText('TXT record for acme.io')).not.toBeInTheDocument();
    const verified = screen.getByText('acme.io').closest('li') as HTMLElement;
    expect(within(verified).getByText('Verified')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(api.verifyDomain).toHaveBeenCalledWith('w-1', 'd-1');
  });

  it('adds a domain as typed, tidied, and refuses one that is not', async () => {
    api.samlConnection.mockResolvedValue(connection());
    api.addDomain.mockResolvedValue(domain({ domain: 'example.com' }));
    const user = setupUser();
    renderWithProviders(<WorkspaceSsoCard workspaceId="w-1" role="ADMIN" />);

    const field = await screen.findByLabelText('Domain');
    await user.type(field, 'https://example.com/');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Enter a domain such as example.com.')).toBeInTheDocument();
    expect(api.addDomain).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, 'Example.COM');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(api.addDomain).toHaveBeenCalledWith('w-1', { domain: 'example.com' }),
    );
  });
});
