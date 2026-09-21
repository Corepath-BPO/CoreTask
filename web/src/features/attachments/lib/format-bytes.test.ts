import { describe, expect, it } from 'vitest';

import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [25 * 1024 * 1024, '25.0 MB'],
    [1024 ** 3, '1.0 GB'],
    // Stops at GB rather than inventing units nobody wants on a file row.
    [5 * 1024 ** 4, '5120.0 GB'],
  ])('%i bytes reads as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('does not pretend nonsense is a size', () => {
    expect(formatBytes(-1)).toBe('-');
    expect(formatBytes(Number.NaN)).toBe('-');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('-');
  });
});
