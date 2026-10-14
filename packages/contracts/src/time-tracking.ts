/**
 * Time tracking — Asana's actual time beside the estimate.
 *
 * Time is logged against a task as entries: who, how long, which day, and an
 * optional note. A task's actual time is the sum of its entries. Durations are
 * whole minutes everywhere; these helpers are the one place they are read from
 * and written as text, so "1h 30m", "90" and "1.5h" all mean the same thing.
 */

export const TIME_ENTRY_MAX_MINUTES = 24 * 60;
export const TIME_ENTRY_NOTE_MAX = 500;

/**
 * Minutes from what a person types: "90", "45m", "1h", "1h 30m", "1.5h",
 * "1:30". Null when it is not a duration, or is zero.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const clock = /^(\d+):([0-5]\d)$/.exec(text);
  if (clock) return positive(Number(clock[1]) * 60 + Number(clock[2]));

  if (/^\d+$/.test(text)) return positive(Number(text));

  const units = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(
    text,
  );
  if (units && (units[1] || units[2])) {
    const hours = units[1] ? Number(units[1]) : 0;
    const minutes = units[2] ? Number(units[2]) : 0;
    return positive(Math.round(hours * 60 + minutes));
  }
  return null;
}

const positive = (minutes: number) =>
  Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;

/** "2h 30m", "45m", "3h" — never "0h 45m" or "2h 0m". */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
