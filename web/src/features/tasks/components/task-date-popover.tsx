import { CalendarDays, Clock, Repeat, X } from 'lucide-react';
import { useState } from 'react';

import { CalendarGrid } from '@/components/ui/calendar-grid';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  calendarDateOf,
  cn,
  formatDate,
  fromYmd,
  timeOf,
  toInstant,
  toIsoCalendarDate,
  ymd,
  type Schedule,
} from '@/lib/utils';

type Field = 'start' | 'due';

interface TaskDatePopoverProps {
  schedule: Schedule;
  /** Only the fields that changed, as the API takes them. */
  onSave: (changes: Partial<Schedule>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the popover hangs from — the row value, the cell, the tail. */
  children: React.ReactNode;
  /** A ticket's deadline is a day: no start date, no time of day. */
  dateOnly?: boolean;
  /** Which end the calendar fills first; the Start column opens on the start. */
  initialField?: Field;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Asana's date picker, hung from whatever shows the date.
 *
 * Two fields on top say which end the calendar is filling; the calendar fills
 * it; "Add time" turns a day into a moment. Every choice saves at once, the
 * way the rest of the panel does — there is no Done, only closing.
 *
 * The body mounts only while open, so each opening starts from the schedule
 * as it stands rather than from whatever a previous visit left behind.
 */
export function TaskDatePopover({
  schedule,
  onSave,
  open,
  onOpenChange,
  children,
  dateOnly = false,
  initialField = 'due',
  align = 'start',
  side,
}: TaskDatePopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span className="flex min-w-0 max-w-full">{children}</span>
      </PopoverAnchor>
      <PopoverContent
        align={align}
        {...(side ? { side } : {})}
        className="w-80 p-3"
        // A click inside the anchor is the trigger's job, not a dismissal.
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-slot="popover-anchor"]')) event.preventDefault();
        }}
      >
        {open && (
          <DatePickerBody
            schedule={schedule}
            onSave={onSave}
            dateOnly={dateOnly}
            initialField={initialField}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function DatePickerBody({
  schedule,
  onSave,
  dateOnly,
  initialField,
}: {
  schedule: Schedule;
  onSave: (changes: Partial<Schedule>) => void;
  dateOnly: boolean;
  initialField: Field;
}) {
  const start = schedule.startDate ? calendarDateOf(schedule.startDate) : null;
  const due = schedule.dueDate ? calendarDateOf(schedule.dueDate) : null;

  const [field, setField] = useState<Field>(dateOnly ? 'due' : initialField);
  const [month, setMonth] = useState(() => fromYmd(due ?? start ?? ymd(new Date())));
  const [timeOpen, setTimeOpen] = useState(Boolean(schedule.dueAt));

  /** The same time of day, on another date. */
  const carry = (at: string | null, day: string) => (at ? toInstant(day, timeOf(at)) : null);

  const pick = (day: string) => {
    if (field === 'start') {
      /*
       * A start needs a due to be a range, so a start picked on its own also
       * sets the due — and a start picked after the due drags the due along,
       * because "starts Friday" cannot mean "was due Wednesday". Then the
       * calendar moves on to the due, as Asana's does.
       */
      const nextDue = due && due >= day ? due : day;
      onSave({
        startDate: toIsoCalendarDate(day),
        startAt: carry(schedule.startAt, day),
        ...(nextDue !== due
          ? { dueDate: toIsoCalendarDate(nextDue), dueAt: carry(schedule.dueAt, nextDue) }
          : {}),
      });
      setField('due');
      return;
    }

    onSave({
      dueDate: toIsoCalendarDate(day),
      dueAt: carry(schedule.dueAt, day),
      // A due before the start leaves no range to speak of; the start goes.
      ...(start && start > day ? { startDate: null, startAt: null } : {}),
    });
  };

  const setDueTime = (time: string) => {
    if (!due) return;
    onSave({ dueDate: toIsoCalendarDate(due), dueAt: time ? toInstant(due, time) : null });
  };

  const setStartTime = (time: string) => {
    if (!start) return;
    onSave({ startDate: toIsoCalendarDate(start), startAt: time ? toInstant(start, time) : null });
  };

  const removeTime = () => {
    onSave({ dueAt: null, startAt: null });
    setTimeOpen(false);
  };

  const clear = () => onSave({ startDate: null, startAt: null, dueDate: null, dueAt: null });

  const hasAnything = Boolean(start || due);

  return (
    <div className="grid gap-3">
      {/* Which end the calendar is filling. Asana puts both fields on top
          and moves between them; the outlined one is the one taking the
          next click. */}
      <div className={cn('grid gap-2', dateOnly ? 'grid-cols-1' : 'grid-cols-2')}>
        {!dateOnly && (
          <FieldButton
            label="Start date"
            value={start ? formatDate(start) : null}
            active={field === 'start'}
            onClick={() => setField('start')}
            onClear={start ? () => onSave({ startDate: null, startAt: null }) : undefined}
          />
        )}
        <FieldButton
          label="Due date"
          value={due ? formatDate(due) : null}
          active={field === 'due'}
          onClick={() => setField('due')}
          onClear={due ? clear : undefined}
        />
      </div>

      <CalendarGrid
        month={month}
        onMonthChange={setMonth}
        rangeStart={start}
        rangeEnd={due}
        onSelect={pick}
        ariaLabel={field === 'start' ? 'Pick a start date' : 'Pick a due date'}
      />

      {!dateOnly && (
        <div className="grid gap-1 border-t pt-2">
          {timeOpen ? (
            <div className="grid gap-1.5">
              <TimeRow
                label="Due time"
                value={schedule.dueAt ? timeOf(schedule.dueAt) : ''}
                disabled={!due}
                hint={due ? undefined : 'Pick a due date first'}
                onChange={setDueTime}
                onRemove={removeTime}
              />
              {/* A start time only means something once the due has one:
                  a range from "the 1st" to "the 5th at 3pm" is lopsided. */}
              {start && schedule.dueAt && (
                <TimeRow
                  label="Start time"
                  value={schedule.startAt ? timeOf(schedule.startAt) : ''}
                  onChange={setStartTime}
                />
              )}
            </div>
          ) : (
            <MenuRow icon={<Clock className="size-4" />} onClick={() => setTimeOpen(true)}>
              Add time
            </MenuRow>
          )}
          <MenuRow
            icon={<Repeat className="size-4" />}
            disabled
            title="Recurring tasks are not built yet"
          >
            Set to repeat
          </MenuRow>
        </div>
      )}

      {hasAnything && (
        <div className="flex justify-end border-t pt-2">
          <button
            type="button"
            onClick={clear}
            className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function FieldButton({
  label,
  value,
  active,
  onClick,
  onClear,
}: {
  label: string;
  value: string | null;
  active: boolean;
  onClick: () => void;
  onClear?: (() => void) | undefined;
}) {
  return (
    <div
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors',
        active ? 'border-ring ring-[3px] ring-ring/25' : 'border-input hover:border-ring/60',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left focus-visible:outline-none"
      >
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ?? label}</span>
      </button>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label.toLowerCase()}`}
          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function TimeRow({
  label,
  value,
  disabled,
  hint,
  onChange,
  onRemove,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  hint?: string | undefined;
  onChange: (time: string) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <input
        type="time"
        value={value}
        disabled={disabled}
        aria-label={label}
        title={hint}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove time"
          className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function MenuRow({
  icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm enabled:cursor-pointer enabled:hover:bg-muted disabled:text-muted-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <span className="text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      {children}
      {disabled && (
        <span className="ml-auto rounded bg-muted px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Soon
        </span>
      )}
    </button>
  );
}
