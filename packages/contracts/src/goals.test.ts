import { describe, expect, it } from 'vitest';

import { metricProgress } from './goals.js';

describe('metricProgress', () => {
  it('measures the way from the start to the target, either direction', () => {
    expect(metricProgress(0, 10, 40)).toBe(25);
    expect(metricProgress(10, 25, 40)).toBe(50);
    expect(metricProgress(100, 70, 40)).toBe(50);
    expect(metricProgress(0, 50, 40)).toBe(100);
    expect(metricProgress(0, -5, 40)).toBe(0);
    expect(metricProgress(5, 5, 5)).toBe(100);
  });
});
