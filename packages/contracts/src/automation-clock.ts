import { AutomationTrigger } from './automation.js';

/**
 * The automation vocabulary that is not about a change: rules started by a
 * person from a task's menu, by a schedule, or by a date drawing near.
 *
 * Shared because three places have to agree on every answer here — the builder
 * shows when a rule will next run, the validator refuses a schedule that never
 * would, and the worker decides what is due right now. Pure functions only: the
 * clock is always a parameter, so each of the three can be tested at any hour.
 */

// ---------------------------------------------------------------------------
// Run manually
// ---------------------------------------------------------------------------

/** The menu label a manual rule may carry — Asana's limit, so the menu stays one line. */
export const MANUAL_RULE_LABEL_MAX = 30;

/** The most tasks one "Run rule" request may name. */
export const MAX_MANUAL_RUN_TASKS = 50;

// ---------------------------------------------------------------------------
// Date triggers
// ---------------------------------------------------------------------------

export const DATE_TRIGGERS = [
  AutomationTrigger.DUE_DATE_APPROACHING,
  AutomationTrigger.TASK_OVERDUE,
  AutomationTrigger.START_DATE_APPROACHING,
  AutomationTrigger.START_DATE_PASSED,
  AutomationTrigger.CUSTOM_DATE_APPROACHING,
  AutomationTrigger.CUSTOM_DATE_PASSED,
] as const;
export type DateTrigger = (typeof DATE_TRIGGERS)[number];

export function isDateTrigger(trigger: string): trigger is DateTrigger {
  return (DATE_TRIGGERS as readonly string[]).includes(trigger);
}

/** The three that take "how many days before". */
export function isApproachingTrigger(trigger: string): boolean {
  return (
    trigger === AutomationTrigger.DUE_DATE_APPROACHING ||
    trigger === AutomationTrigger.START_DATE_APPROACHING ||
    trigger === AutomationTrigger.CUSTOM_DATE_APPROACHING
  );
}

/** The two that watch a custom date field rather than the task's own dates; they need a `fieldId`. */
export function isCustomDateTrigger(trigger: string): boolean {
  return (
    trigger === AutomationTrigger.CUSTOM_DATE_APPROACHING ||
    trigger === AutomationTrigger.CUSTOM_DATE_PASSED
  );
}

/** Every trigger the worker's clock starts rather than a request. */
export function isClockTrigger(trigger: string): boolean {
  return isDateTrigger(trigger) || trigger === AutomationTrigger.SCHEDULED_TIME;
}

/** "Due in N days": zero is the day itself. */
export const APPROACHING_DAYS = { MIN: 0, MAX: 30, DEFAULT: 1 } as const;

/** The days an approaching trigger is configured with, defaulted and clamped. */
export function approachingDays(configuration: Record<string, unknown>): number {
  const raw = configuration['days'];
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return APPROACHING_DAYS.DEFAULT;
  return Math.min(APPROACHING_DAYS.MAX, Math.max(APPROACHING_DAYS.MIN, raw));
}

/** The dates a date trigger reads. Strings are ISO; a date-only column is UTC midnight. */
export interface DatedTask {
  dueDate: Date | string | null;
  dueAt: Date | string | null;
  startDate: Date | string | null;
  /** The watched custom date field's value, for the two custom-date triggers. */
  customDate?: Date | string | null;
}

/**
 * When a date trigger's condition holds for a task, as instants.
 *
 * `opensAt` is the moment it becomes true — the morning N days before the due
 * date, the moment a task falls overdue — and `closesAt` the moment it stops
 * being worth announcing: a task already overdue is past "approaching". Null
 * when the task has no such date.
 *
 * Mornings are the rule's timezone's, because "due tomorrow" depends on where
 * the reader is, and a date column holds a calendar day rather than an instant.
 * A due *time* makes "overdue" exact; without one, a task is overdue once its
 * day is over.
 */
export function dateTriggerWindow(
  trigger: DateTrigger,
  task: DatedTask,
  days: number,
  timeZone: string,
): { opensAt: Date; closesAt: Date | null } | null {
  const midnight = (day: CalendarDay, offsetDays: number) =>
    zonedTimeToUtc(day.year, day.month, day.day + offsetDays, 0, 0, timeZone);

  const due = calendarDay(task.dueDate);
  const dueAt = task.dueAt ? new Date(task.dueAt) : null;
  const overdueAt = due ? (dueAt ?? midnight(due, 1)) : null;
  const start = calendarDay(task.startDate);
  const custom = calendarDay(task.customDate ?? null);

  switch (trigger) {
    case AutomationTrigger.DUE_DATE_APPROACHING:
      return due && overdueAt ? { opensAt: midnight(due, -days), closesAt: overdueAt } : null;
    case AutomationTrigger.TASK_OVERDUE:
      return overdueAt ? { opensAt: overdueAt, closesAt: null } : null;
    case AutomationTrigger.START_DATE_APPROACHING:
      return start ? { opensAt: midnight(start, -days), closesAt: midnight(start, 0) } : null;
    case AutomationTrigger.START_DATE_PASSED:
      return start ? { opensAt: midnight(start, 0), closesAt: null } : null;
    // A custom date reads like a due date with no time: near from N mornings
    // before, passed once its day is over.
    case AutomationTrigger.CUSTOM_DATE_APPROACHING:
      return custom ? { opensAt: midnight(custom, -days), closesAt: midnight(custom, 1) } : null;
    case AutomationTrigger.CUSTOM_DATE_PASSED:
      return custom ? { opensAt: midnight(custom, 1), closesAt: null } : null;
  }
}

/**
 * Whether a date trigger should fire now.
 *
 * `since` is when the rule went live: a rule published today announces what
 * happens from today, rather than every task that fell overdue last year. The
 * worker also remembers each firing, so this answers "is it due", not "has it
 * been done".
 */
export function dateTriggerIsDue(
  window: { opensAt: Date; closesAt: Date | null },
  now: Date,
  since: Date,
): boolean {
  if (window.opensAt.getTime() > now.getTime()) return false;
  if (window.opensAt.getTime() <= since.getTime()) return false;
  return window.closesAt === null || now.getTime() < window.closesAt.getTime();
}

// ---------------------------------------------------------------------------
// Scheduled time
// ---------------------------------------------------------------------------

export const ScheduleFrequency = {
  DAILY: 'DAILY',
  WEEKDAYS: 'WEEKDAYS',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type ScheduleFrequency = (typeof ScheduleFrequency)[keyof typeof ScheduleFrequency];
export const SCHEDULE_FREQUENCIES = Object.values(ScheduleFrequency);

export const SCHEDULE_FREQUENCY_LABEL: Record<ScheduleFrequency, string> = {
  DAILY: 'Every day',
  WEEKDAYS: 'Every weekday',
  WEEKLY: 'Every week',
  MONTHLY: 'Every month',
};

export const WEEKDAY_LABEL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Which tasks a scheduled rule runs on — Asana's "execution scope".
 *
 * A change-driven rule has the task that changed; a schedule has only the
 * time, so it has to be told which tasks it is about. The rule's conditions
 * then narrow that set exactly as they narrow a change. `NONE` is a rule that
 * only makes something new — "every Monday, create the standup task".
 */
export const ExecutionScope = {
  NONE: 'NONE',
  ALL: 'ALL',
  INCOMPLETE: 'INCOMPLETE',
  SECTION: 'SECTION',
  STALE: 'STALE',
} as const;
export type ExecutionScope = (typeof ExecutionScope)[keyof typeof ExecutionScope];
export const EXECUTION_SCOPES = Object.values(ExecutionScope);

export const EXECUTION_SCOPE_LABEL: Record<ExecutionScope, string> = {
  NONE: 'No existing tasks — only create new ones',
  ALL: 'Every task in the project',
  INCOMPLETE: 'Incomplete tasks',
  SECTION: 'Incomplete tasks in a section',
  STALE: 'Incomplete tasks nobody has touched for a while',
};

/** The most tasks one scheduled run acts on; the rest wait for the next run. */
export const MAX_SCHEDULED_TASKS_PER_RUN = 200;

export const STALE_DAYS = { MIN: 1, MAX: 365, DEFAULT: 7 } as const;

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  /** 24-hour wall-clock time in `timezone`, `HH:MM`. */
  time: string;
  /** 0 Sunday … 6 Saturday; read for WEEKLY. */
  weekday: number;
  /** 1–31; read for MONTHLY. A month without that day runs on its last. */
  dayOfMonth: number;
  /** An IANA zone, e.g. `America/Chicago`. */
  timezone: string;
  scope: ExecutionScope;
  /** Read for SECTION. */
  sectionId: string | null;
  /** Read for STALE. */
  staleDays: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  frequency: ScheduleFrequency.WEEKLY,
  time: '09:00',
  weekday: 1,
  dayOfMonth: 1,
  timezone: 'UTC',
  scope: ExecutionScope.INCOMPLETE,
  sectionId: null,
  staleDays: STALE_DAYS.DEFAULT,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * A stored schedule, with a default for anything missing or malformed.
 *
 * Lenient on purpose: the builder renders a half-made schedule while somebody
 * fills it in. `scheduleProblems` is the strict half, and publishing asks it.
 */
export function readSchedule(configuration: Record<string, unknown>): ScheduleConfig {
  const pick = <T>(value: unknown, ok: (v: unknown) => v is T, fallback: T): T =>
    ok(value) ? value : fallback;

  return {
    frequency: pick(
      configuration['frequency'],
      (v): v is ScheduleFrequency => SCHEDULE_FREQUENCIES.includes(v as ScheduleFrequency),
      DEFAULT_SCHEDULE.frequency,
    ),
    time: pick(
      configuration['time'],
      (v): v is string => typeof v === 'string' && TIME_PATTERN.test(v),
      DEFAULT_SCHEDULE.time,
    ),
    weekday: pick(configuration['weekday'], (v): v is number => isInt(v, 0, 6), 1),
    dayOfMonth: pick(configuration['dayOfMonth'], (v): v is number => isInt(v, 1, 31), 1),
    timezone: pick(configuration['timezone'], isTimeZone, DEFAULT_SCHEDULE.timezone),
    scope: pick(
      configuration['scope'],
      (v): v is ExecutionScope => EXECUTION_SCOPES.includes(v as ExecutionScope),
      DEFAULT_SCHEDULE.scope,
    ),
    sectionId:
      typeof configuration['sectionId'] === 'string' && configuration['sectionId'] !== ''
        ? configuration['sectionId']
        : null,
    staleDays: pick(
      configuration['staleDays'],
      (v): v is number => isInt(v, STALE_DAYS.MIN, STALE_DAYS.MAX),
      STALE_DAYS.DEFAULT,
    ),
  };
}

/** What stops a stored schedule running as written. Empty when it can. */
export function scheduleProblems(configuration: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const has = (key: string) => configuration[key] !== undefined;

  if (!SCHEDULE_FREQUENCIES.includes(configuration['frequency'] as ScheduleFrequency)) {
    problems.push('Choose how often the rule runs.');
  }
  if (typeof configuration['time'] !== 'string' || !TIME_PATTERN.test(configuration['time'])) {
    problems.push('Choose a time of day, as HH:MM.');
  }
  if (
    configuration['frequency'] === ScheduleFrequency.WEEKLY &&
    !isInt(configuration['weekday'], 0, 6)
  ) {
    problems.push('Choose the day of the week.');
  }
  if (
    configuration['frequency'] === ScheduleFrequency.MONTHLY &&
    !isInt(configuration['dayOfMonth'], 1, 31)
  ) {
    problems.push('Choose a day of the month between 1 and 31.');
  }
  if (!isTimeZone(configuration['timezone'])) {
    problems.push('The schedule’s timezone is not one this server recognises.');
  }
  if (!EXECUTION_SCOPES.includes(configuration['scope'] as ExecutionScope)) {
    problems.push('Choose which tasks the rule runs on.');
  }
  if (configuration['scope'] === ExecutionScope.SECTION && !configuration['sectionId']) {
    problems.push('Choose the section whose tasks the rule runs on.');
  }
  if (
    configuration['scope'] === ExecutionScope.STALE &&
    has('staleDays') &&
    !isInt(configuration['staleDays'], STALE_DAYS.MIN, STALE_DAYS.MAX)
  ) {
    problems.push(`Untouched for how long has to be ${STALE_DAYS.MIN}–${STALE_DAYS.MAX} days.`);
  }

  return problems;
}

/** Whether a local calendar day is one the schedule runs on. */
function runsOn(schedule: ScheduleConfig, day: CalendarDay): boolean {
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();

  switch (schedule.frequency) {
    case ScheduleFrequency.DAILY:
      return true;
    case ScheduleFrequency.WEEKDAYS:
      return weekday >= 1 && weekday <= 5;
    case ScheduleFrequency.WEEKLY:
      return weekday === schedule.weekday;
    case ScheduleFrequency.MONTHLY: {
      const last = new Date(Date.UTC(day.year, day.month, 0)).getUTCDate();
      return day.day === Math.min(schedule.dayOfMonth, last);
    }
  }
}

/** The run on one local day, as an instant. */
function runOn(schedule: ScheduleConfig, day: CalendarDay): Date {
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number];
  return zonedTimeToUtc(day.year, day.month, day.day, hour, minute, schedule.timezone);
}

/** Far enough to find a monthly run from any day, with room for a short month. */
const SEARCH_DAYS = 64;

/** The most recent run at or before `now`, or null if none in the last two months. */
export function latestOccurrence(schedule: ScheduleConfig, now: Date): Date | null {
  const today = localDay(now, schedule.timezone);

  for (let back = 0; back <= SEARCH_DAYS; back += 1) {
    const day = shiftDay(today, -back);
    if (!runsOn(schedule, day)) continue;

    const at = runOn(schedule, day);
    if (at.getTime() <= now.getTime()) return at;
  }

  return null;
}

/** The next run after `now` — what the builder shows as "Next run". */
export function nextOccurrence(schedule: ScheduleConfig, now: Date): Date | null {
  const today = localDay(now, schedule.timezone);

  for (let ahead = 0; ahead <= SEARCH_DAYS; ahead += 1) {
    const day = shiftDay(today, ahead);
    if (!runsOn(schedule, day)) continue;

    const at = runOn(schedule, day);
    if (at.getTime() > now.getTime()) return at;
  }

  return null;
}

/** A schedule in one line: "Every week on Monday at 09:00 (America/Chicago)". */
export function describeSchedule(schedule: ScheduleConfig): string {
  const when =
    schedule.frequency === ScheduleFrequency.WEEKLY
      ? `Every ${WEEKDAY_LABEL[schedule.weekday]}`
      : schedule.frequency === ScheduleFrequency.MONTHLY
        ? `Every month on day ${schedule.dayOfMonth}`
        : SCHEDULE_FREQUENCY_LABEL[schedule.frequency];

  return `${when} at ${schedule.time} (${schedule.timezone})`;
}

// ---------------------------------------------------------------------------
// Time zones, without a library
// ---------------------------------------------------------------------------

export interface CalendarDay {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
  };
}

/** The calendar day an instant falls on in a zone. */
export function localDay(instant: Date, timeZone: string): CalendarDay {
  const { year, month, day } = wallClock(instant, timeZone);
  return { year, month, day };
}

/**
 * A wall-clock time in a zone, as an instant.
 *
 * Guesses as though the zone were UTC, then corrects by the offset the zone
 * actually had at the guess — twice, so a guess that lands across a daylight-
 * saving change settles on the right side of it. Days out of range roll over
 * (day 0 is the last of the previous month), which is what makes "N days
 * before" plain arithmetic for the callers.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;

  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += target - seenAsUtc;
  }

  return new Date(guess);
}

function shiftDay(day: CalendarDay, offset: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + offset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** A date-only column's calendar day, whether it arrived as a Date or a string. */
function calendarDay(value: Date | string | null): CalendarDay | null {
  if (value === null) return null;

  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match
      ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
      : null;
  }

  if (Number.isNaN(value.getTime())) return null;
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

// ---------------------------------------------------------------------------
// Variables in text actions
// ---------------------------------------------------------------------------

/**
 * What a rule's text may name, written `{{task.name}}`.
 *
 * Without these a "Set task name" action could only write a constant, giving
 * every task it touches the same words. With them it can say "Follow up:
 * {{task.name}}" and mean the task in front of it.
 */
export const AUTOMATION_TEXT_VARIABLES = [
  { key: 'task.name', label: 'Task name' },
  { key: 'task.assignee', label: 'Assignee' },
  { key: 'task.due_date', label: 'Due date' },
  { key: 'task.start_date', label: 'Start date' },
  { key: 'project.name', label: 'Project name' },
  { key: 'triggered_by', label: 'Who triggered the rule' },
  { key: 'today', label: 'Today’s date' },
] as const;
export type AutomationTextVariable = (typeof AUTOMATION_TEXT_VARIABLES)[number]['key'];

const KNOWN_VARIABLES = new Set<string>(AUTOMATION_TEXT_VARIABLES.map((entry) => entry.key));
const VARIABLE_PATTERN = /\{\{\s*([a-z_.]+)\s*\}\}/g;

/** How a variable is written into text. */
export function variableToken(key: AutomationTextVariable): string {
  return `{{${key}}}`;
}

/**
 * Text with its variables filled in.
 *
 * A known variable with no value — a task nobody is assigned to — becomes an
 * empty string rather than the placeholder, which would read as a bug. An
 * unknown one is left exactly as written: it may be literal text that happens
 * to use braces.
 */
export function renderAutomationText(
  template: string,
  values: Partial<Record<AutomationTextVariable, string>>,
): string {
  return template.replace(VARIABLE_PATTERN, (written, key: string) =>
    KNOWN_VARIABLES.has(key) ? (values[key as AutomationTextVariable] ?? '') : written,
  );
}

/** Variables written in text that this engine does not know — for a warning. */
export function unknownVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const key = match[1] ?? '';
    if (!KNOWN_VARIABLES.has(key)) unknown.add(key);
  }
  return [...unknown];
}
