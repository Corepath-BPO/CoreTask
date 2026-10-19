/**
 * The "Wait" step: a rule that pauses before what follows it.
 *
 * A run reaching a Wait step stops there and is picked up again by the clock
 * once the time has passed. Whatever follows — conditions included — is then
 * judged against the task or ticket as it is by then, which is what makes
 * "wait two days, then if it is still open, nudge" work.
 */

/** The step's subtype, and the catalogue row that adds one. */
export const DELAY_SUBTYPE = 'DELAY';

export const AutomationDelayUnit = {
  MINUTES: 'MINUTES',
  HOURS: 'HOURS',
  DAYS: 'DAYS',
} as const;
export type AutomationDelayUnit = (typeof AutomationDelayUnit)[keyof typeof AutomationDelayUnit];
export const AUTOMATION_DELAY_UNITS = Object.values(AutomationDelayUnit);

const UNIT_MS: Record<AutomationDelayUnit, number> = {
  MINUTES: 60_000,
  HOURS: 3_600_000,
  DAYS: 86_400_000,
};

const UNIT_WORD: Record<AutomationDelayUnit, [string, string]> = {
  MINUTES: ['minute', 'minutes'],
  HOURS: ['hour', 'hours'],
  DAYS: ['day', 'days'],
};

export const AUTOMATION_DELAY_UNIT_LABEL: Record<AutomationDelayUnit, string> = {
  MINUTES: 'Minutes',
  HOURS: 'Hours',
  DAYS: 'Days',
};

/** The longest a rule may wait: past this, a rule is a reminder service. */
export const DELAY_MAX_DAYS = 90;

/** What a new Wait step starts as. */
export const DEFAULT_DELAY = { amount: 1, unit: AutomationDelayUnit.DAYS } as const;

/** What is wrong with a Wait step's settings, or null. */
export function delayProblem(config: Record<string, unknown>): string | null {
  const amount = config['amount'];
  const unit = config['unit'] as AutomationDelayUnit;
  if (!AUTOMATION_DELAY_UNITS.includes(unit)) return 'Choose minutes, hours or days.';
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
    return 'Wait a whole number of them, one or more.';
  }
  if (amount * UNIT_MS[unit] > DELAY_MAX_DAYS * UNIT_MS.DAYS) {
    return `A rule waits ${DELAY_MAX_DAYS} days at most.`;
  }
  return null;
}

/** How long a Wait step waits, or null while its settings are unfinished. */
export function delayMs(config: Record<string, unknown>): number | null {
  if (delayProblem(config)) return null;
  return (config['amount'] as number) * UNIT_MS[config['unit'] as AutomationDelayUnit];
}

/** "2 days", or null while the settings are unfinished. */
export function delayLength(config: Record<string, unknown>): string | null {
  if (delayProblem(config)) return null;
  const amount = config['amount'] as number;
  const [one, many] = UNIT_WORD[config['unit'] as AutomationDelayUnit];
  return `${amount} ${amount === 1 ? one : many}`;
}

/** "Wait 2 days" — or what it still needs. */
export function describeDelay(config: Record<string, unknown>): string {
  const length = delayLength(config);
  return length ? `Wait ${length}` : 'Wait — choose how long';
}
