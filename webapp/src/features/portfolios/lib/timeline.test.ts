import type { ProjectSummary } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { barGeometry, buildAxis, buildTimelineRange, monthOffset, quarterGroups } from './timeline';

const project = (overrides: Partial<ProjectSummary>): ProjectSummary =>
  ({ startDate: null, dueDate: null, ...overrides }) as ProjectSummary;

describe('timeline geometry', () => {
  it('spans at least a year even with no dated projects', () => {
    const range = buildTimelineRange([], new Date(2026, 7, 18));

    expect(range.months.length).toBeGreaterThanOrEqual(12);
    // Two lead months before today's month.
    expect(range.start.getFullYear()).toBe(2026);
    expect(range.start.getMonth()).toBe(5);
  });

  it('stretches to cover every project date with breathing room', () => {
    const range = buildTimelineRange(
      [project({ startDate: '2026-03-10', dueDate: '2027-02-01' })],
      new Date(2026, 7, 18),
    );

    expect(range.start.getMonth()).toBe(0); // March minus two lead months
    expect(range.months.length).toBeGreaterThanOrEqual(16); // Jan 2026 through ≥Apr 2027
  });

  it('measures fractional months from the range start', () => {
    const start = new Date(2026, 0, 1);

    expect(monthOffset(start, new Date(2026, 0, 1))).toBe(0);
    expect(monthOffset(start, new Date(2026, 3, 1))).toBe(3);
    expect(monthOffset(start, new Date(2026, 1, 15))).toBeCloseTo(1.5, 1);
  });

  it('groups the axis months into calendar quarters', () => {
    const range = buildTimelineRange([], new Date(2026, 7, 18));
    const groups = quarterGroups(range.months);

    expect(groups.reduce((sum, group) => sum + group.span, 0)).toBe(range.months.length);
    expect(groups[0]?.label).toMatch(/^Q[1-4] \d{4}$/);
  });

  it('draws no bar without dates, and a visible one for a single day', () => {
    const start = new Date(2026, 0, 1);

    expect(barGeometry(project({}), start)).toBeNull();

    const single = barGeometry(project({ startDate: '2026-06-15', dueDate: '2026-06-15' }), start);
    expect(single).not.toBeNull();
    expect(single?.span).toBeGreaterThan(0);
  });

  it('tolerates a due date before the start date', () => {
    const start = new Date(2026, 0, 1);
    const swapped = barGeometry(project({ startDate: '2026-09-01', dueDate: '2026-06-01' }), start);

    expect(swapped?.offset).toBeCloseTo(monthOffset(start, new Date(2026, 5, 1)), 5);
    expect(swapped?.span).toBeGreaterThan(2.9);
  });

  it('stretches the range further when a coarse zoom asks for it', () => {
    const range = buildTimelineRange([], new Date(2026, 7, 18), 36);

    expect(range.months.length).toBeGreaterThanOrEqual(36);
  });
});

describe('timeline axis', () => {
  const range = buildTimelineRange([], new Date(2026, 7, 18));
  const PX = 100;
  const totalWidth = range.months.length * PX;

  it('puts years over bare quarter labels when zoomed all the way out', () => {
    const axis = buildAxis(range, 'years', PX);

    expect(axis.top.every((cell) => /^\d{4}$/.test(cell.label))).toBe(true);
    expect(axis.bottom.every((cell) => /^Q[1-4]$/.test(cell.label))).toBe(true);
    expect(axis.top.reduce((sum, cell) => sum + cell.width, 0)).toBe(totalWidth);
    expect(axis.bottom.reduce((sum, cell) => sum + cell.width, 0)).toBe(totalWidth);
  });

  it('tiles Monday-start week cells across the months view without gaps', () => {
    const axis = buildAxis(range, 'months', PX);

    for (let index = 1; index < axis.bottom.length; index += 1) {
      const previous = axis.bottom[index - 1]!;
      expect(axis.bottom[index]!.x).toBeCloseTo(previous.x + previous.width, 5);
    }
    expect(axis.bottom[0]?.x).toBe(0);
    const last = axis.bottom[axis.bottom.length - 1]!;
    expect(last.x + last.width).toBeCloseTo(totalWidth, 5);
  });

  it('draws one day cell per calendar day, shading only weekends', () => {
    const axis = buildAxis(range, 'days', PX);

    const expectedDays = range.months.reduce(
      (sum, month) => sum + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
      0,
    );
    expect(axis.bottom).toHaveLength(expectedDays);
    // Two shaded days per full week, give or take the partial edges.
    expect(axis.bands.length).toBeGreaterThanOrEqual(Math.floor(expectedDays / 7) * 2 - 2);
    expect(axis.lines.filter((line) => line.strong)).toHaveLength(range.months.length);
  });
});
