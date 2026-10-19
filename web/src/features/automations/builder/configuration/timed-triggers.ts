import {
  APPROACHING_DAYS,
  AutomationTrigger,
  DEFAULT_SCHEDULE,
  isApproachingTrigger,
  isDateTrigger,
} from '@coretask/contracts';

/**
 * Defaults for the triggers that run on the clock, and the timezones they
 * are read in.
 *
 * A schedule or a due date is read in somebody's own zone — "9am", "due
 * tomorrow" — so a new one starts in the zone of whoever is building it,
 * rather than in UTC, where a 9am rule built in Chicago would run at 3am.
 */

/** The zone this browser is in, or UTC where it cannot say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every zone the browser knows, with this browser's and UTC guaranteed. */
export function timeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  const known = typeof supported === 'function' ? supported('timeZone') : [];

  return [...new Set([browserTimeZone(), 'UTC', ...known])];
}

/**
 * What a trigger starts with when it is chosen.
 *
 * Only the clock's triggers have anything to start with; every other trigger
 * starts empty, as it always has.
 */
export function defaultTriggerConfiguration(subtype: string): Record<string, unknown> {
  if (subtype === AutomationTrigger.SCHEDULED_TIME) {
    return {
      frequency: DEFAULT_SCHEDULE.frequency,
      time: DEFAULT_SCHEDULE.time,
      weekday: DEFAULT_SCHEDULE.weekday,
      dayOfMonth: DEFAULT_SCHEDULE.dayOfMonth,
      timezone: browserTimeZone(),
      scope: DEFAULT_SCHEDULE.scope,
    };
  }

  if (isDateTrigger(subtype)) {
    return {
      timezone: browserTimeZone(),
      ...(isApproachingTrigger(subtype) ? { days: APPROACHING_DAYS.DEFAULT } : {}),
    };
  }

  return {};
}
