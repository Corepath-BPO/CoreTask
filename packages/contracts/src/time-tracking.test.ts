import { describe, expect, it } from 'vitest';

import { formatMinutes, parseDuration } from './time-tracking.js';

describe('parseDuration', () => {
  it('reads the ways people write a duration', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('2 hours 15 minutes')).toBe(135);
    expect(parseDuration('1:30')).toBe(90);
  });

  it('refuses what is not a duration, or nothing at all', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('writes hours and minutes, leaving out a zero part', () => {
    expect(formatMinutes(150)).toBe('2h 30m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(180)).toBe('3h');
    expect(formatMinutes(0)).toBe('0m');
  });
});
