import { describe, expect, it } from 'vitest';

import {
  approachingDays,
  dateTriggerIsDue,
  dateTriggerWindow,
  describeSchedule,
  latestOccurrence,
  nextOccurrence,
  readSchedule,
  renderAutomationText,
  scheduleProblems,
  unknownVariables,
  zonedTimeToUtc,
  type ScheduleConfig,
} from './automation-clock';

const schedule = (overrides: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  ...readSchedule({}),
  ...overrides,
});

describe('zonedTimeToUtc', () => {
  it('turns a wall-clock time in a zone into the instant it names', () => {
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, 'America/Chicago').toISOString()).toBe(
      '2026-01-15T15:00:00.000Z',
    );
    // Daylight saving: Chicago is UTC−5 in July.
    expect(zonedTimeToUtc(2026, 7, 15, 9, 0, 'America/Chicago').toISOString()).toBe(
      '2026-07-15T14:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 3, 1, 0, 0, 'Asia/Manila').toISOString()).toBe(
      '2026-02-28T16:00:00.000Z',
    );
  });

  it('rolls days over, so "N days before" is arithmetic', () => {
    expect(zonedTimeToUtc(2026, 3, 0, 0, 0, 'UTC').toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('schedules', () => {
  it('finds the most recent weekly run, and the next one', () => {
    const weekly = schedule({ frequency: 'WEEKLY', weekday: 1, time: '09:00', timezone: 'UTC' });
    // Wednesday 14 October 2026.
    const now = new Date('2026-10-14T12:00:00Z');

    expect(latestOccurrence(weekly, now)?.toISOString()).toBe('2026-10-12T09:00:00.000Z');
    expect(nextOccurrence(weekly, now)?.toISOString()).toBe('2026-10-19T09:00:00.000Z');
  });

  it('counts a run as happened once its minute arrives, in the schedule’s zone', () => {
    const daily = schedule({ frequency: 'DAILY', time: '09:00', timezone: 'Asia/Manila' });

    expect(latestOccurrence(daily, new Date('2026-10-14T00:59:00Z'))?.toISOString()).toBe(
      '2026-10-13T01:00:00.000Z',
    );
    expect(latestOccurrence(daily, new Date('2026-10-14T01:00:00Z'))?.toISOString()).toBe(
      '2026-10-14T01:00:00.000Z',
    );
  });

  it('skips weekends on weekdays, and runs a monthly rule on a short month’s last day', () => {
    const weekdays = schedule({ frequency: 'WEEKDAYS', time: '08:00', timezone: 'UTC' });
    // Sunday 18 October: the last weekday run was Friday.
    expect(latestOccurrence(weekdays, new Date('2026-10-18T12:00:00Z'))?.toISOString()).toBe(
      '2026-10-16T08:00:00.000Z',
    );

    const monthly = schedule({ frequency: 'MONTHLY', dayOfMonth: 31, time: '07:30' });
    expect(nextOccurrence(monthly, new Date('2026-02-10T00:00:00Z'))?.toISOString()).toBe(
      '2026-02-28T07:30:00.000Z',
    );
  });

  it('reads leniently and validates strictly', () => {
    expect(readSchedule({ frequency: 'HOURLY', time: '25:00', timezone: 'Nowhere/City' })).toEqual(
      expect.objectContaining({ frequency: 'WEEKLY', time: '09:00', timezone: 'UTC' }),
    );

    expect(
      scheduleProblems({
        frequency: 'WEEKLY',
        time: '9am',
        weekday: 9,
        timezone: 'Nowhere/City',
        scope: 'SECTION',
      }),
    ).toEqual([
      'Choose a time of day, as HH:MM.',
      'Choose the day of the week.',
      'The schedule’s timezone is not one this server recognises.',
      'Choose the section whose tasks the rule runs on.',
    ]);

    expect(
      scheduleProblems({
        frequency: 'DAILY',
        time: '17:45',
        timezone: 'Europe/London',
        scope: 'INCOMPLETE',
      }),
    ).toEqual([]);
  });

  it('describes itself in one line', () => {
    expect(
      describeSchedule(
        schedule({ frequency: 'WEEKLY', weekday: 5, time: '16:00', timezone: 'Europe/London' }),
      ),
    ).toBe('Every Friday at 16:00 (Europe/London)');
  });
});

describe('date triggers', () => {
  const task = { dueDate: '2026-10-20', dueAt: null, startDate: '2026-10-16' };

  it('opens "due date approaching" on the morning N days before, until it is overdue', () => {
    const window = dateTriggerWindow('DUE_DATE_APPROACHING', task, 2, 'UTC');
    expect(window?.opensAt.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(window?.closesAt?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('makes a task overdue when its day is over, or at its due time if it has one', () => {
    expect(dateTriggerWindow('TASK_OVERDUE', task, 0, 'UTC')?.opensAt.toISOString()).toBe(
      '2026-10-21T00:00:00.000Z',
    );
    expect(
      dateTriggerWindow(
        'TASK_OVERDUE',
        { ...task, dueAt: '2026-10-20T15:30:00.000Z' },
        0,
        'UTC',
      )?.opensAt.toISOString(),
    ).toBe('2026-10-20T15:30:00.000Z');
  });

  it('uses the rule’s zone for a calendar day', () => {
    expect(
      dateTriggerWindow('START_DATE_PASSED', task, 0, 'America/New_York')?.opensAt.toISOString(),
    ).toBe('2026-10-16T04:00:00.000Z');
  });

  it('reads a custom date field like a due date without a time', () => {
    const dated = { ...task, customDate: '2026-11-03T00:00:00.000Z' };
    const near = dateTriggerWindow('CUSTOM_DATE_APPROACHING', dated, 3, 'UTC');
    expect(near?.opensAt.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(near?.closesAt?.toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(dateTriggerWindow('CUSTOM_DATE_PASSED', dated, 0, 'UTC')?.opensAt.toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    );
    // The task's own dates are not the field's.
    expect(dateTriggerWindow('CUSTOM_DATE_PASSED', task, 0, 'UTC')).toBeNull();
  });

  it('has nothing to say about a task without the date', () => {
    expect(
      dateTriggerWindow('TASK_OVERDUE', { dueDate: null, dueAt: null, startDate: null }, 0, 'UTC'),
    ).toBeNull();
  });

  it('fires only inside the window, and only for what happened after the rule went live', () => {
    const window = {
      opensAt: new Date('2026-10-18T00:00:00Z'),
      closesAt: new Date('2026-10-21T00:00:00Z'),
    };
    const live = new Date('2026-10-01T00:00:00Z');

    expect(dateTriggerIsDue(window, new Date('2026-10-17T23:59:00Z'), live)).toBe(false);
    expect(dateTriggerIsDue(window, new Date('2026-10-18T00:00:00Z'), live)).toBe(true);
    expect(dateTriggerIsDue(window, new Date('2026-10-21T00:00:00Z'), live)).toBe(false);
    // Published after the window opened: not announced retroactively.
    expect(
      dateTriggerIsDue(window, new Date('2026-10-19T00:00:00Z'), new Date('2026-10-18T06:00:00Z')),
    ).toBe(false);
  });

  it('clamps the days an approaching trigger is configured with', () => {
    expect(approachingDays({})).toBe(1);
    expect(approachingDays({ days: 3 })).toBe(3);
    expect(approachingDays({ days: 400 })).toBe(30);
    expect(approachingDays({ days: 1.5 })).toBe(1);
  });
});

describe('text variables', () => {
  it('fills known variables, blanks missing ones and leaves unknown ones alone', () => {
    expect(
      renderAutomationText('Follow up: {{task.name}} for {{ task.assignee }} {{weather}}', {
        'task.name': 'Lease renewal',
      }),
    ).toBe('Follow up: Lease renewal for  {{weather}}');
  });

  it('lists the variables it does not know', () => {
    expect(unknownVariables('{{task.name}} {{weather}} {{weather}} {{TASK}}')).toEqual(['weather']);
  });
});
