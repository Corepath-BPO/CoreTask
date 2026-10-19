import { describe, expect, it } from 'vitest';

import { isTimeZone } from './automation-clock.js';
import { isAway, outOfOfficeLabel } from './profile.js';

describe('profile', () => {
  const period = { from: '2026-10-19', until: '2026-10-23' };

  it('knows who is away on a given day, both ends included', () => {
    expect(isAway(period, '2026-10-18')).toBe(false);
    expect(isAway(period, '2026-10-19')).toBe(true);
    expect(isAway(period, '2026-10-23')).toBe(true);
    expect(isAway(null, '2026-10-20')).toBe(false);
  });

  it('says it ahead of time, while it lasts, and not after', () => {
    expect(outOfOfficeLabel(period, '2026-10-14')).toBe('Out of office Oct 19 – Oct 23');
    expect(outOfOfficeLabel(period, '2026-10-20')).toBe('Out of office until Oct 23');
    expect(outOfOfficeLabel(period, '2026-10-24')).toBeNull();
  });

  it('accepts real time zones only', () => {
    expect(isTimeZone('America/Chicago')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});
