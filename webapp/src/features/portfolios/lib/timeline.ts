import type { ProjectSummary } from '@coretask/types';

/**
 * Geometry for the Gantt-style timeline: everything is measured in fractional
 * months from the range start, and the page multiplies by pixels-per-month.
 */
export interface TimelineRange {
  start: Date;
  /** First day of every month on the axis, in order. */
  months: Date[];
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

/** Whole months from `a` to `b`, both taken as their month. */
export function monthDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Fractional months from the range start to `date` — the bar geometry unit. */
export function monthOffset(rangeStart: Date, date: Date): number {
  return monthDiff(rangeStart, date) + (date.getDate() - 1) / daysInMonth(date);
}

const LEAD_MONTHS = 2;
const TAIL_MONTHS = 3;
const MIN_MONTHS = 12;

/**
 * The axis spans every project date plus breathing room, and never less than a
 * year so an empty or single-project portfolio still reads as a timeline.
 * Coarser zooms pass a larger `minMonths` so the canvas doesn't run dry.
 */
export function buildTimelineRange(
  projects: ProjectSummary[],
  today: Date,
  minMonths: number = MIN_MONTHS,
): TimelineRange {
  const dates: Date[] = [today];
  for (const project of projects) {
    if (project.startDate) dates.push(new Date(project.startDate));
    if (project.dueDate) dates.push(new Date(project.dueDate));
  }

  const min = new Date(Math.min(...dates.map(Number)));
  const max = new Date(Math.max(...dates.map(Number)));

  const start = addMonths(startOfMonth(min), -LEAD_MONTHS);
  let end = addMonths(startOfMonth(max), TAIL_MONTHS + 1);
  if (monthDiff(start, end) < minMonths) end = addMonths(start, minMonths);

  const months: Date[] = [];
  for (let month = start; month < end; month = addMonths(month, 1)) {
    months.push(month);
  }

  return { start, months };
}

export function quarterLabel(date: Date): string {
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}

/** Months grouped into calendar quarters for the header's top row. */
export function quarterGroups(months: Date[]): { label: string; span: number }[] {
  const groups: { label: string; span: number }[] = [];

  for (const month of months) {
    const label = quarterLabel(month);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.span += 1;
    } else {
      groups.push({ label, span: 1 });
    }
  }

  return groups;
}

export interface BarGeometry {
  /** In fractional months from the range start. */
  offset: number;
  /** In fractional months; never zero, so a one-day project stays visible. */
  span: number;
}

/** Null when the project has no dates — Asana leaves the lane empty too. */
export function barGeometry(project: ProjectSummary, rangeStart: Date): BarGeometry | null {
  if (!project.startDate && !project.dueDate) return null;

  const startDate = new Date(project.startDate ?? (project.dueDate as string));
  const dueDate = new Date(project.dueDate ?? (project.startDate as string));
  const [first, last] = startDate <= dueDate ? [startDate, dueDate] : [dueDate, startDate];

  const offset = monthOffset(rangeStart, first);
  // The bar covers the due day itself, hence the extra day.
  const end = monthOffset(rangeStart, last) + 1 / daysInMonth(last);

  return { offset, span: Math.max(end - offset, 0.08) };
}

/** What one axis column represents at a given zoom step. */
export type TimelineUnit = 'years' | 'quarters' | 'months' | 'days';

export interface AxisCell {
  key: string;
  label: string;
  x: number;
  width: number;
}

export interface AxisLine {
  x: number;
  strong: boolean;
}

/** A shaded vertical band — weekends, at the Days zoom. */
export interface AxisBand {
  key: string;
  x: number;
  width: number;
}

export interface TimelineAxis {
  /** Header's top row: years, quarters, or months, depending on the unit. */
  top: AxisCell[];
  /** Header's bottom row: quarters, months, week starts, or day numbers. */
  bottom: AxisCell[];
  lines: AxisLine[];
  bands: AxisBand[];
}

/**
 * Everything the page needs to draw one zoom level, in pixels: both header
 * rows, the gridlines, and any shading. Zooming swaps the unit, not just the
 * scale — years over quarters, quarters over months, months over week starts,
 * months over day numbers — the way Asana's − / + walks its axis.
 */
export function buildAxis(
  range: TimelineRange,
  unit: TimelineUnit,
  pxPerMonth: number,
): TimelineAxis {
  const { start, months } = range;
  const end = addMonths(start, months.length);
  const x = (date: Date) => monthOffset(start, date) * pxPerMonth;

  const monthCells = (label: (month: Date) => string): AxisCell[] =>
    months.map((month, index) => ({
      key: month.toISOString(),
      label: label(month),
      x: index * pxPerMonth,
      width: pxPerMonth,
    }));

  /** Adjacent months sharing a label melt into one wide cell. */
  const groupedCells = (label: (month: Date) => string): AxisCell[] => {
    const cells: AxisCell[] = [];
    months.forEach((month, index) => {
      const name = label(month);
      const last = cells[cells.length - 1];
      if (last && last.label === name) {
        last.width += pxPerMonth;
      } else {
        cells.push({
          key: month.toISOString(),
          label: name,
          x: index * pxPerMonth,
          width: pxPerMonth,
        });
      }
    });
    return cells;
  };

  const monthName = (month: Date) => month.toLocaleString('en-US', { month: 'long' });

  if (unit === 'years') {
    return {
      top: groupedCells((month) => String(month.getFullYear())),
      bottom: groupedCells((month) => `Q${Math.floor(month.getMonth() / 3) + 1}`),
      lines: months
        .filter((month) => month.getMonth() % 3 === 0)
        .map((month) => ({ x: x(month), strong: month.getMonth() === 0 })),
      bands: [],
    };
  }

  if (unit === 'quarters') {
    return {
      top: groupedCells(quarterLabel),
      bottom: monthCells(monthName),
      lines: months.map((month, index) => ({
        x: index * pxPerMonth,
        strong: month.getMonth() % 3 === 0,
      })),
      bands: [],
    };
  }

  if (unit === 'months') {
    const bottom: AxisCell[] = [];
    const lines: AxisLine[] = months.map((_month, index) => ({
      x: index * pxPerMonth,
      strong: true,
    }));

    // Cells tile Monday to Monday; the first and last may be partial weeks.
    let cursor = new Date(start);
    while (cursor < end) {
      const daysToMonday = (8 - cursor.getDay()) % 7 || 7;
      const next = addDays(cursor, daysToMonday);
      const stop = next < end ? next : end;
      bottom.push({
        key: cursor.toISOString(),
        label: String(cursor.getDate()),
        x: x(cursor),
        width: x(stop) - x(cursor),
      });
      if (+cursor !== +start && cursor.getDate() !== 1) {
        lines.push({ x: x(cursor), strong: false });
      }
      cursor = next;
    }

    return {
      top: monthCells((month) => `${monthName(month)} ${month.getFullYear()}`),
      bottom,
      lines,
      bands: [],
    };
  }

  const bottom: AxisCell[] = [];
  const lines: AxisLine[] = [];
  const bands: AxisBand[] = [];
  for (let day = new Date(start); day < end; day = addDays(day, 1)) {
    const left = x(day);
    const width = x(addDays(day, 1)) - left;
    bottom.push({ key: day.toISOString(), label: String(day.getDate()), x: left, width });
    lines.push({ x: left, strong: day.getDate() === 1 });
    if (day.getDay() === 0 || day.getDay() === 6) {
      bands.push({ key: day.toISOString(), x: left, width });
    }
  }

  return { top: monthCells(monthName), bottom, lines, bands };
}
