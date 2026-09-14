import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretReveal } from './secret-reveal';

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

const SECRET = 'ctk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';

describe('SecretReveal', () => {
  beforeEach(() => {
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it('starts masked and can be shown and hidden again', async () => {
    const user = userEvent.setup();
    render(<SecretReveal secret={SECRET} label="API key" />);

    const input = screen.getByLabelText('API key');
    expect(input).toHaveValue(SECRET);
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(input).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide API key' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('copies the raw secret even while it is masked', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<SecretReveal secret={SECRET} label="API key" />);
    await user.click(screen.getByRole('button', { name: 'Copy API key' }));

    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(toastSuccess).toHaveBeenCalledWith('Copied');
  });

  /** Plain http on a LAN has no clipboard API; the page must say so, not throw. */
  it('reports a missing clipboard instead of failing silently', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(<SecretReveal secret={SECRET} label="API key" />);
    await user.click(screen.getByRole('button', { name: 'Copy API key' }));

    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not copy/i));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
