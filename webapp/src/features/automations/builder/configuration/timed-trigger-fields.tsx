import {
  APPROACHING_DAYS,
  EXECUTION_SCOPE_LABEL,
  EXECUTION_SCOPES,
  ExecutionScope,
  MANUAL_RULE_LABEL_MAX,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_FREQUENCY_LABEL,
  ScheduleFrequency,
  STALE_DAYS,
  WEEKDAY_LABEL,
  isApproachingTrigger,
  isCustomDateTrigger,
  nextOccurrence,
  readSchedule,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import { Field } from '@/components/forms/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';

import { RadioItem } from './radio-item';
import { browserTimeZone, timeZones } from './timed-triggers';

type Configure = (configuration: Record<string, unknown>) => void;

/** A whole number from a text box, or undefined while it is empty. */
const whole = (raw: string): number | undefined =>
  raw === '' ? undefined : Math.trunc(Number(raw));

/**
 * The zone a clock trigger is read in. Offered on every one of them, because
 * "9am" and "due tomorrow" both depend on whose morning it is.
 */
function TimeZoneField({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: Configure;
}) {
  const zone =
    typeof configuration['timezone'] === 'string' ? configuration['timezone'] : browserTimeZone();

  return (
    <Field label="Timezone" htmlFor="trigger-timezone">
      <Select value={zone} onValueChange={(timezone) => onChange({ ...configuration, timezone })}>
        <SelectTrigger id="trigger-timezone" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {timeZones().map((entry) => (
            <RadioItem key={entry} value={entry}>
              {entry.replace(/_/g, ' ')}
            </RadioItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** "Rule is run manually": what the menu calls it. */
export function ManualTriggerFields({
  configuration,
  onChange,
}: {
  configuration: Record<string, unknown>;
  onChange: Configure;
}) {
  const label = typeof configuration['label'] === 'string' ? configuration['label'] : '';

  return (
    <div className="space-y-4">
      <Field
        label="Menu label"
        htmlFor="trigger-label"
        hint="Shown under Run rule in a task’s “…” menu. Left empty, the rule’s name is used."
      >
        <Input
          id="trigger-label"
          value={label}
          maxLength={MANUAL_RULE_LABEL_MAX}
          placeholder="e.g. Send to review"
          onChange={(event) =>
            onChange({ ...configuration, label: event.target.value || undefined })
          }
        />
      </Field>
      <p className="text-sm text-muted-foreground">
        Anyone who can edit this project’s tasks can run it, on one task or on several selected in
        the list.
      </p>
    </div>
  );
}

/**
 * "Due date is approaching", "Task is overdue", their start-date pair, and a
 * custom date field's "is approaching" and "is overdue" — which also ask which
 * field.
 */
export function DateTriggerFields({
  subtype,
  configuration,
  metadata,
  onChange,
}: {
  subtype: string;
  configuration: Record<string, unknown>;
  metadata?: AutomationMetadata | undefined;
  onChange: Configure;
}) {
  const days = typeof configuration['days'] === 'number' ? String(configuration['days']) : '';
  const fieldId = typeof configuration['fieldId'] === 'string' ? configuration['fieldId'] : '';
  const dateFields = (metadata?.customFields ?? []).filter((field) => field.type === 'DATE');

  return (
    <div className="space-y-4">
      {isCustomDateTrigger(subtype) && (
        <Field
          label="Date field"
          htmlFor="trigger-date-field"
          hint={dateFields.length === 0 ? 'This project has no date fields yet.' : undefined}
        >
          <Select
            value={fieldId}
            onValueChange={(next) => {
              // Radix reports '' while the fields are still loading; that is not a choice.
              if (next) onChange({ ...configuration, fieldId: next });
            }}
          >
            <SelectTrigger id="trigger-date-field" className="w-full">
              <SelectValue placeholder="Choose a date field" />
            </SelectTrigger>
            <SelectContent>
              {dateFields.map((field) => (
                <RadioItem key={field.id} value={field.id}>
                  {field.name}
                </RadioItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {isApproachingTrigger(subtype) && (
        <Field
          label="Days before"
          htmlFor="trigger-days"
          hint="0 fires on the morning of the day itself."
        >
          <Input
            id="trigger-days"
            type="number"
            min={APPROACHING_DAYS.MIN}
            max={APPROACHING_DAYS.MAX}
            step={1}
            value={days}
            onChange={(event) => onChange({ ...configuration, days: whole(event.target.value) })}
          />
        </Field>
      )}
      <TimeZoneField configuration={configuration} onChange={onChange} />
      <p className="text-sm text-muted-foreground">
        Checked every minute, for tasks that are not complete. Each task is announced once per date
        — change the date and it can fire again.
      </p>
    </div>
  );
}

const NEXT_RUN_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Scheduled time occurs…": when, in which zone, and on which tasks. */
export function ScheduleTriggerFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: Configure;
}) {
  const schedule = readSchedule(configuration);
  const set = (key: string, value: unknown) => onChange({ ...configuration, [key]: value });
  const next = nextOccurrence(schedule, new Date());

  return (
    <div className="space-y-4">
      <Field label="How often" htmlFor="trigger-frequency">
        <Select value={schedule.frequency} onValueChange={(value) => set('frequency', value)}>
          <SelectTrigger id="trigger-frequency" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_FREQUENCIES.map((frequency) => (
              <RadioItem key={frequency} value={frequency}>
                {SCHEDULE_FREQUENCY_LABEL[frequency]}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {schedule.frequency === ScheduleFrequency.WEEKLY && (
        <Field label="On" htmlFor="trigger-weekday">
          <Select
            value={String(schedule.weekday)}
            onValueChange={(value) => set('weekday', Number(value))}
          >
            <SelectTrigger id="trigger-weekday" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_LABEL.map((day, index) => (
                <RadioItem key={day} value={String(index)}>
                  {day}
                </RadioItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {schedule.frequency === ScheduleFrequency.MONTHLY && (
        <Field
          label="Day of the month"
          htmlFor="trigger-day-of-month"
          hint="A month without that day runs on its last."
        >
          <Input
            id="trigger-day-of-month"
            type="number"
            min={1}
            max={31}
            step={1}
            value={
              typeof configuration['dayOfMonth'] === 'number'
                ? String(configuration['dayOfMonth'])
                : ''
            }
            onChange={(event) => set('dayOfMonth', whole(event.target.value))}
          />
        </Field>
      )}

      <Field label="At" htmlFor="trigger-time">
        <Input
          id="trigger-time"
          type="time"
          step={60}
          value={typeof configuration['time'] === 'string' ? configuration['time'] : ''}
          onChange={(event) => set('time', event.target.value || undefined)}
        />
      </Field>

      <TimeZoneField configuration={configuration} onChange={onChange} />

      <Field
        label="Run on"
        htmlFor="trigger-scope"
        hint="The rule’s checks still apply to each task it runs on."
      >
        <Select value={schedule.scope} onValueChange={(value) => set('scope', value)}>
          <SelectTrigger id="trigger-scope" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXECUTION_SCOPES.map((scope) => (
              <RadioItem key={scope} value={scope}>
                {EXECUTION_SCOPE_LABEL[scope]}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {schedule.scope === ExecutionScope.SECTION && (
        <Field label="Section" htmlFor="trigger-scope-section">
          <Select
            value={schedule.sectionId ?? ''}
            onValueChange={(value) => set('sectionId', value)}
          >
            <SelectTrigger id="trigger-scope-section" className="w-full">
              <SelectValue placeholder="Choose a section" />
            </SelectTrigger>
            <SelectContent>
              {(metadata?.sections ?? []).map((section) => (
                <RadioItem key={section.id} value={section.id}>
                  {section.name}
                </RadioItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {schedule.scope === ExecutionScope.STALE && (
        <Field label="Untouched for at least (days)" htmlFor="trigger-stale-days">
          <Input
            id="trigger-stale-days"
            type="number"
            min={STALE_DAYS.MIN}
            max={STALE_DAYS.MAX}
            step={1}
            value={
              typeof configuration['staleDays'] === 'number'
                ? String(configuration['staleDays'])
                : String(STALE_DAYS.DEFAULT)
            }
            onChange={(event) => set('staleDays', whole(event.target.value))}
          />
        </Field>
      )}

      {schedule.scope === ExecutionScope.NONE && (
        <p className="text-sm text-muted-foreground">
          With no tasks to run on, the rule can only create new ones — add a “Create a task” step.
        </p>
      )}

      {next && (
        <p className="text-sm text-muted-foreground">
          Next run:{' '}
          <span className="font-medium text-foreground">{NEXT_RUN_FORMAT.format(next)}</span>
        </p>
      )}
    </div>
  );
}
