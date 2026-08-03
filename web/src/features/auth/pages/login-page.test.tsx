import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent, waitFor } from '@/test/test-utils';

import { LoginPage } from './login-page';

// The network is mocked so these stay unit tests: they assert the form's
// validation and submission contract, not the API's behaviour. Real request
// handling is covered by the API e2e suite and the Playwright specs.
const login = vi.fn();

vi.mock('../hooks/use-auth', () => ({
  useAuth: () => ({
    login: {
      mutateAsync: login,
      isPending: false,
      error: null,
    },
    register: { mutateAsync: vi.fn(), isPending: false, error: null },
    logout: { mutate: vi.fn(), isPending: false },
    signOut: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    login.mockReset();
    login.mockResolvedValue(undefined);
  });

  it('renders the sign-in form', async () => {
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    expect(screen.getByRole('heading', { name: /sign in to coretask/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it('blocks submission and reports both fields when empty', async () => {
    const user = userEvent.setup();
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/e-mail address is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/password is required/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('rejects a malformed e-mail address', async () => {
    const user = userEvent.setup();
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/^password/i), 'CoreTask!2024');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/enter a valid e-mail address/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('submits normalised credentials when the form is valid', async () => {
    const user = userEvent.setup();
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    await user.type(screen.getByLabelText(/email/i), '  Demo@CoreTask.dev ');
    await user.type(screen.getByLabelText(/^password/i), 'CoreTask!2024');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    // Zod trims and lower-cases before the value reaches the API.
    expect(login).toHaveBeenCalledWith({
      email: 'demo@coretask.dev',
      password: 'CoreTask!2024',
    });
  });

  it('toggles password visibility without losing the value', async () => {
    const user = userEvent.setup();
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    const password = screen.getByLabelText(/^password/i);
    await user.type(password, 'CoreTask!2024');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('CoreTask!2024');

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('offers a link to registration', async () => {
    await renderWithRouter(LoginPage, { initialPath: '/login' });

    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute(
      'href',
      '/register',
    );
  });
});
