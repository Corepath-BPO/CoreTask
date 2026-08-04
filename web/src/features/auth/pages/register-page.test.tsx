import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent, waitFor } from '@/test/test-utils';

import { RegisterPage } from './register-page';

// The network is mocked so these stay unit tests: they assert the form's
// validation and submission contract, not the API's behaviour.
const registerUser = vi.fn();

vi.mock('../hooks/use-auth', () => ({
  useAuth: () => ({
    register: { mutateAsync: registerUser, isPending: false, error: null },
    login: { mutateAsync: vi.fn(), isPending: false, error: null },
    logout: { mutate: vi.fn(), isPending: false },
    signOut: vi.fn(),
  }),
}));

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example-company.com',
  password: 'CoreTask!2024',
};

async function fillAndSubmit(overrides: Partial<typeof VALID> = {}) {
  const values = { ...VALID, ...overrides };
  const user = userEvent.setup();

  await user.type(screen.getByLabelText(/full name/i), values.name);
  const email = screen.getByLabelText(/work email/i);
  if ((email as HTMLInputElement).value === '') await user.type(email, values.email);
  await user.type(screen.getByLabelText(/^password/i), values.password);
  await user.type(screen.getByLabelText(/confirm password/i), values.password);
  await user.click(screen.getByLabelText(/i agree/i));
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    registerUser.mockReset();
    registerUser.mockResolvedValue(undefined);
  });

  it('submits a valid form', async () => {
    await renderWithRouter(RegisterPage, { initialPath: '/register' });
    await fillAndSubmit();

    await waitFor(() =>
      expect(registerUser).toHaveBeenCalledWith({
        name: VALID.name,
        email: VALID.email,
        password: VALID.password,
      }),
    );
  });

  /*
   * The invitation flow depends on both of these. Someone with no account
   * lands on /invitations/<token>, clicks "Create an account", and arrives here
   * with ?redirect=/invitations/<token>&email=<invited address>.
   *
   * Ignoring either one strands them: without the redirect they finish signup
   * on the dashboard with the invitation silently abandoned, and without the
   * prefill they can register the wrong address and hit "this invitation was
   * sent to someone else" with no way back.
   */
  describe('arriving from an invitation', () => {
    const TOKEN_PATH = '/invitations/abc123';

    /*
     * Asserted on what renders rather than on `window.location`: the test router
     * uses an in-memory history, so the browser URL never changes and a pathname
     * assertion would pass or fail for reasons unrelated to the navigation. The
     * harness's /invitations/$token stub renders this text.
     */
    it('returns to the invitation after signing up, not the dashboard', async () => {
      await renderWithRouter(RegisterPage, {
        initialPath: `/register?redirect=${encodeURIComponent(TOKEN_PATH)}`,
      });

      await fillAndSubmit();

      await waitFor(() => expect(registerUser).toHaveBeenCalled());
      expect(await screen.findByText('accept invitation')).toBeInTheDocument();
    });

    it('prefills the invited address so the account matches the invitation', async () => {
      await renderWithRouter(RegisterPage, {
        initialPath: `/register?redirect=${encodeURIComponent(TOKEN_PATH)}&email=${encodeURIComponent('invited@example-company.com')}`,
      });

      const email = screen.getByLabelText(/work email/i) as HTMLInputElement;
      expect(email.value).toBe('invited@example-company.com');
      // Editable rather than locked: someone may genuinely want a different
      // address, and the API rejects a mismatch anyway.
      expect(email).not.toHaveAttribute('readonly');
    });

    it('does not divert to an invitation when no redirect was given', async () => {
      await renderWithRouter(RegisterPage, { initialPath: '/register' });
      await fillAndSubmit();

      await waitFor(() => expect(registerUser).toHaveBeenCalled());
      expect(screen.queryByText('accept invitation')).not.toBeInTheDocument();
    });
  });
});
