/**
 * A person's profile — Asana's "My profile settings": who they are beyond a
 * name, and when they are away. Shared so the server's limits and the form's
 * agree, and so every screen says "out of office" the same way.
 */

export const PROFILE_PRONOUNS_MAX = 40;
export const PROFILE_JOB_TITLE_MAX = 80;
export const PROFILE_DEPARTMENT_MAX = 80;
export const PROFILE_ABOUT_ME_MAX = 1000;
export const OUT_OF_OFFICE_NOTE_MAX = 200;

// Time zones are checked with `isTimeZone`, from automation-clock.

/** A stretch of calendar days, both ends inclusive, as `yyyy-mm-dd`. */
export interface OutOfOfficePeriod {
  from: string;
  until: string;
  note?: string | null;
}

/** Whether someone is away on `today` (`yyyy-mm-dd`). */
export function isAway(period: OutOfOfficePeriod | null | undefined, today: string): boolean {
  return Boolean(period && period.from <= today && today <= period.until);
}

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const short = (day: string) => SHORT.format(new Date(`${day}T00:00:00Z`));

/**
 * How a pickers and profiles say it: "Out of office until Oct 20" while it is
 * on, "Out of office Oct 20 – Oct 24" before it starts, nothing once it is over.
 */
export function outOfOfficeLabel(
  period: OutOfOfficePeriod | null | undefined,
  today: string,
): string | null {
  if (!period || period.until < today) return null;
  if (period.from <= today) return `Out of office until ${short(period.until)}`;
  return `Out of office ${short(period.from)} – ${short(period.until)}`;
}
