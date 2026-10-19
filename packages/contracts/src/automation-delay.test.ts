import { describe, expect, it } from 'vitest';

import { delayLength, delayMs, delayProblem, describeDelay } from './automation-delay.js';

describe('the Wait step', () => {
  it('measures and names a wait', () => {
    expect(delayMs({ amount: 2, unit: 'DAYS' })).toBe(2 * 86_400_000);
    expect(delayMs({ amount: 90, unit: 'MINUTES' })).toBe(90 * 60_000);
    expect(describeDelay({ amount: 1, unit: 'HOURS' })).toBe('Wait 1 hour');
    expect(describeDelay({ amount: 3, unit: 'DAYS' })).toBe('Wait 3 days');
    expect(delayLength({ amount: 45, unit: 'MINUTES' })).toBe('45 minutes');
  });

  it('refuses what cannot be waited for', () => {
    expect(delayProblem({ amount: 2, unit: 'WEEKS' })).toMatch(/minutes, hours or days/);
    expect(delayProblem({ amount: 0, unit: 'DAYS' })).toMatch(/one or more/);
    expect(delayProblem({ amount: 1.5, unit: 'DAYS' })).toMatch(/whole number/);
    expect(delayProblem({ amount: 91, unit: 'DAYS' })).toMatch(/90 days at most/);
    expect(delayProblem({ amount: 2160, unit: 'HOURS' })).toBeNull();
    expect(delayMs({})).toBeNull();
    expect(describeDelay({})).toBe('Wait — choose how long');
    expect(delayLength({ amount: 0, unit: 'DAYS' })).toBeNull();
  });
});
