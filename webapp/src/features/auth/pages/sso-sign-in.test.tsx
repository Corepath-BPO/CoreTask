import { ERROR_CODE_MESSAGES } from '@coretask/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/app/config/env';
import { renderWithRouter, screen, setupUser, waitFor } from '@/test/test-utils';

import type * as SsoApiModule from '../api/sso.api';

import { LoginPage } from './login-page';
import { RegisterPage } from './register-page';
import { SsoPage } from './sso-page';

const providers = vi.fn();
const leaveFor = vi.fn();

// Only the network is stood in for: the start addresses are built for real,
// since the links they make are what these tests are about.
vi.mock('../api/sso.api', async (importOriginal) => {
  const actual = await importOriginal<typeof SsoApiModule>();
  return { ssoApi: { ...actual.ssoApi, providers: () => providers() } };
});

vi.mock('../lib/leave-for', () => ({ leaveFor: (url: string) => leaveFor(url) }));

vi.mock('../hooks/use-auth', () => ({
  useAuth: () => ({
    login: { mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn() },
    register: { mutateAsync: vi.fn(), isPending: false, error: null },
  }),
}));

describe('signing in with Google, Microsoft or SSO', () => {
  beforeEach(() => {
    providers.mockResolvedValue({ google: true, microsoft: false, saml: true });
  });

  it('offers the providers this server has, as links to the API that keep the redirect', async () => {
    await renderWithRouter(LoginPage, { initialPath: '/login?redirect=%2Fprojects' });

    const google = await screen.findByRole('link', { name: /continue with google/i });
    expect(google).toHaveAttribute(
      'href',
      `${env.apiUrl}/auth/sso/google/start?redirect=%2Fprojects`,
    );
    expect(
      screen.queryByRole('link', { name: /continue with microsoft/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in with sso/i })).toHaveAttribute(
      'href',
      '/sso?redirect=%2Fprojects',
    );
  });

  it('keeps to the e-mail form and SSO when the server offers neither provider, or cannot say', async () => {
    providers.mockRejectedValue(new Error('offline'));
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    await waitFor(() => expect(providers).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /sign in with sso/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /continue with/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('says why single sign-on sent the person back, and reads an unknown code as a failure', async () => {
    const { unmount } = await renderWithRouter(LoginPage, {
      initialPath: '/login?ssoError=SSO_EMAIL_UNVERIFIED',
    });
    expect(screen.getByText(ERROR_CODE_MESSAGES.SSO_EMAIL_UNVERIFIED)).toBeInTheDocument();
    unmount();

    await renderWithRouter(LoginPage, { initialPath: '/login?ssoError=SOMETHING_NEW' });
    expect(screen.getByText(ERROR_CODE_MESSAGES.SSO_FAILED)).toBeInTheDocument();
  });

  it('offers the same on sign-up', async () => {
    providers.mockResolvedValue({ google: true, microsoft: true, saml: true });
    await renderWithRouter(RegisterPage, { initialPath: '/register' });

    expect(await screen.findByRole('link', { name: /continue with microsoft/i })).toHaveAttribute(
      'href',
      `${env.apiUrl}/auth/sso/microsoft/start`,
    );
    expect(screen.getByRole('link', { name: /continue with google/i })).toBeInTheDocument();
  });
});

describe('SsoPage', () => {
  it('sends a work address to the SAML start, with the redirect', async () => {
    const user = setupUser();
    await renderWithRouter(SsoPage, { initialPath: '/sso?redirect=%2Finbox' });

    await user.type(screen.getByLabelText(/work e-mail or workspace/i), ' Ada@Acme.com ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(leaveFor).toHaveBeenCalledWith(
      `${env.apiUrl}/auth/sso/saml/start?email=ada%40acme.com&redirect=%2Finbox`,
    );
  });

  it('takes a workspace by its slug, or by its link', async () => {
    const user = setupUser();
    await renderWithRouter(SsoPage, { initialPath: '/sso' });

    await user.type(
      screen.getByLabelText(/work e-mail or workspace/i),
      'https://app.coretask.dev/w/Acme-Co/projects',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(leaveFor).toHaveBeenCalledWith(`${env.apiUrl}/auth/sso/saml/start?workspace=acme-co`);
  });

  it('asks again for something that is neither, and goes nowhere', async () => {
    const user = setupUser();
    await renderWithRouter(SsoPage, { initialPath: '/sso' });

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/enter your work e-mail address/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/work e-mail or workspace/i), 'not@an address');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('says when the workspace has no single sign-on', async () => {
    await renderWithRouter(SsoPage, { initialPath: '/sso?error=SAML_NOT_CONFIGURED' });
    expect(screen.getByText(ERROR_CODE_MESSAGES.SAML_NOT_CONFIGURED)).toBeInTheDocument();
  });
});
