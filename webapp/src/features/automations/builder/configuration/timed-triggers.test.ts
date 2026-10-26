import { describe, expect, it } from 'vitest';

import { browserTimeZone, defaultTriggerConfiguration, timeZones } from './timed-triggers';

describe('defaults for the clock triggers', () => {
  it('starts a schedule weekly at nine, in this browser’s zone, on incomplete tasks', () => {
    expect(defaultTriggerConfiguration('SCHEDULED_TIME')).toEqual({
      frequency: 'WEEKLY',
      time: '09:00',
      weekday: 1,
      dayOfMonth: 1,
      timezone: browserTimeZone(),
      scope: 'INCOMPLETE',
    });
  });

  it('gives an approaching trigger a day’s notice, and every date trigger a zone', () => {
    expect(defaultTriggerConfiguration('DUE_DATE_APPROACHING')).toEqual({
      timezone: browserTimeZone(),
      days: 1,
    });
    expect(defaultTriggerConfiguration('TASK_OVERDUE')).toEqual({ timezone: browserTimeZone() });
  });

  it('leaves every other trigger empty', () => {
    expect(defaultTriggerConfiguration('TASK_CREATED')).toEqual({});
    expect(defaultTriggerConfiguration('RUN_MANUALLY')).toEqual({});
  });

  it('offers this browser’s zone first, and UTC, once each', () => {
    const zones = timeZones();
    expect(zones[0]).toBe(browserTimeZone());
    expect(zones.filter((zone) => zone === 'UTC')).toHaveLength(1);
  });
});
