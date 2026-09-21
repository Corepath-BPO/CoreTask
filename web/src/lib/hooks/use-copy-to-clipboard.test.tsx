import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCopyToClipboard } from './use-copy-to-clipboard';

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies, flags `copied`, and clears the flag after the reset delay', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard(1000));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.copy('hello', { success: 'Copied' });
    });

    expect(outcome).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(toastSuccess).toHaveBeenCalledWith('Copied');
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });

  it('reports a rejected write as a failure, not an exception', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not focused'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard());

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.copy('hello', { failure: 'Nope' });
    });

    expect(outcome).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Nope');
    expect(result.current.copied).toBe(false);
  });

  it('handles a browser with no clipboard API at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    const { result } = renderHook(() => useCopyToClipboard());

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.copy('hello');
    });

    expect(outcome).toBe(false);
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not copy/i));
  });
});
