import { describe, expect, it } from 'vitest';

import { daysUntil, formatDueDate, humanizeEnum, initials, percentage } from './format';

describe('initials', () => {
  it('takes the first and last name initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Maya Chidinma Okafor')).toBe('MO');
  });

  it('falls back to a single letter for a one-word name', () => {
    expect(initials('Demo')).toBe('D');
  });

  it('does not throw on empty input', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('daysUntil', () => {
  it('ignores the time of day when counting calendar days', () => {
    const today = new Date();
    today.setHours(23, 59, 0, 0);
    expect(daysUntil(today)).toBe(0);
  });

  it('returns a negative count for past dates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(daysUntil(yesterday)).toBe(-1);
  });
});

describe('formatDueDate', () => {
  it('uses words for the days around today', () => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(formatDueDate(today)).toBe('Today');
    expect(formatDueDate(tomorrow)).toBe('Tomorrow');
  });

  it('calls out overdue work explicitly', () => {
    const past = new Date();
    past.setDate(past.getDate() - 4);
    expect(formatDueDate(past)).toBe('4d overdue');
  });
});

describe('humanizeEnum', () => {
  it('turns a SCREAMING_SNAKE value into sentence case', () => {
    expect(humanizeEnum('IN_PROGRESS')).toBe('In progress');
    expect(humanizeEnum('OPEN')).toBe('Open');
  });
});

describe('percentage', () => {
  it('rounds to the nearest whole percent', () => {
    expect(percentage(1, 3)).toBe(33);
    expect(percentage(14, 22)).toBe(64);
  });

  it('returns 0 rather than NaN when the total is zero', () => {
    expect(percentage(0, 0)).toBe(0);
  });
});
