import {
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABEL,
  RECURRENCE_INTERVAL_MAX,
  RecurrenceFrequency,
  describeRecurrence,
  type TaskRecurrence,
} from '@coretask/contracts';
import { Repeat } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const WEEKDAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const UNIT: Record<RecurrenceFrequency, string> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  YEARLY: 'year',
  PERIODICALLY: 'day',
};

/**
 * Asana's "Set to repeat", as a row of its own under the due date.
 *
 * Completing a repeating task creates the next one — the API does it, from
 * whichever screen the task was completed on — so all this asks is the
 * pattern: how often, every how many, and on which days for a weekly one.
 */
export function TaskRepeatControl({
  recurrence,
  disabled,
  onChange,
}: {
  recurrence: TaskRecurrence | null;
  disabled: boolean;
  onChange: (recurrence: TaskRecurrence | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Repeat"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            !recurrence && 'text-muted-foreground',
            !disabled && 'cursor-pointer',
          )}
        >
          <Repeat className="size-3.5" aria-hidden="true" />
          {recurrence ? describeRecurrence(recurrence) : 'Does not repeat'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        {/* Built fresh on each opening, from what the task holds now. */}
        {open && (
          <RepeatForm
            initial={recurrence}
            onCancel={() => setOpen(false)}
            onSave={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The pattern itself: how often, every how many, which weekdays. */
export function RepeatForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: TaskRecurrence | null;
  onSave: (recurrence: TaskRecurrence | null) => void;
  onCancel: () => void;
}) {
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    initial?.frequency ?? RecurrenceFrequency.WEEKLY,
  );
  const [every, setEvery] = useState(String(initial?.interval ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);

  const count = Number(every);
  const valid = Number.isInteger(count) && count >= 1 && count <= RECURRENCE_INTERVAL_MAX;

  const toggleDay = (day: number) =>
    setWeekdays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort(),
    );

  const save = () => {
    if (!valid) return;
    onSave({
      frequency,
      interval: count,
      ...(frequency === RecurrenceFrequency.WEEKLY && weekdays.length > 0 ? { weekdays } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Set to repeat</p>

      <Select
        value={frequency}
        onValueChange={(value) => setFrequency(value as RecurrenceFrequency)}
      >
        <SelectTrigger aria-label="How often" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RECURRENCE_FREQUENCIES.map((option) => (
            <SelectItem key={option} value={option}>
              {RECURRENCE_FREQUENCY_LABEL[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2 text-sm">
        {frequency !== RecurrenceFrequency.PERIODICALLY && <span>Every</span>}
        <Input
          aria-label="Every how many"
          type="number"
          min={1}
          max={RECURRENCE_INTERVAL_MAX}
          value={every}
          onChange={(event) => setEvery(event.target.value)}
          className="h-8 w-20"
        />
        <span>
          {UNIT[frequency]}
          {count === 1 ? '' : 's'}
          {frequency === RecurrenceFrequency.PERIODICALLY ? ' after it is completed' : ''}
        </span>
      </div>

      {frequency === RecurrenceFrequency.WEEKLY && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            On — none chosen repeats on the due date’s own weekday
          </p>
          <div className="flex gap-1" role="group" aria-label="Days of the week">
            {WEEKDAY_INITIAL.map((initialLetter, day) => (
              <button
                key={WEEKDAY_NAME[day]}
                type="button"
                aria-label={WEEKDAY_NAME[day]}
                aria-pressed={weekdays.includes(day)}
                onClick={() => toggleDay(day)}
                className={cn(
                  'size-8 rounded-full border text-xs font-medium',
                  weekdays.includes(day)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {initialLetter}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Completing the task creates the next one, due on the next date in the pattern.
      </p>

      <div className="flex items-center justify-between gap-2">
        {initial ? (
          <Button variant="ghost" size="sm" onClick={() => onSave(null)}>
            Stop repeating
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={!valid}>
          Save
        </Button>
      </div>
    </div>
  );
}
