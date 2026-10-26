import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';

import { cn, fromYmd, ymd } from '@/lib/utils';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_FORMAT = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
const DAY_FORMAT = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

interface CalendarGridProps {
  /** Any day of the month on show. */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** `yyyy-mm-dd`. The range is inclusive, and either end may be absent. */
  rangeStart?: string | null;
  rangeEnd?: string | null;
  onSelect: (day: string) => void;
  ariaLabel?: string;
}

/**
 * A month of days, the way a date picker draws one.
 *
 * Weeks start on Sunday, as Asana's do for a US workspace. Six rows always,
 * so the picker does not change height between a four-week February and a
 * six-week March. One roving tab stop — the range end, else today, else the
 * first — and the arrow keys walk the days, crossing into the next month
 * rather than stopping at its edge.
 */
export function CalendarGrid({
  month,
  onMonthChange,
  rangeStart,
  rangeEnd,
  onSelect,
  ariaLabel = 'Calendar',
}: CalendarGridProps) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());

  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });

  const today = ymd(new Date());
  const preferred = rangeEnd ?? rangeStart ?? today;
  const tabStop = days.some((day) => ymd(day) === preferred) ? preferred : ymd(first);

  const gridRef = useRef<HTMLDivElement>(null);

  const shiftMonth = (delta: number) => {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  };

  const moveFocus = (from: string, deltaDays: number) => {
    const next = fromYmd(from);
    next.setDate(next.getDate() + deltaDays);
    const key = ymd(next);

    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
      onMonthChange(new Date(next.getFullYear(), next.getMonth(), 1));
    }

    // The button for that day exists once the month has rendered.
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)?.focus();
    });
  };

  const onKeyDown = (event: React.KeyboardEvent, day: string) => {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    moveFocus(day, delta);
  };

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium" aria-live="polite">
          {MONTH_FORMAT.format(first)}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div ref={gridRef} role="grid" aria-label={ariaLabel}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((weekday, index) => (
            <div
              key={index}
              role="columnheader"
              className="py-1 text-center text-[11px] font-medium text-muted-foreground"
            >
              {weekday}
            </div>
          ))}
        </div>

        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} role="row" className="grid grid-cols-7">
            {days.slice(row * 7, row * 7 + 7).map((day) => {
              const key = ymd(day);
              const inMonth = day.getMonth() === month.getMonth();
              const isStart = key === rangeStart;
              const isEnd = key === rangeEnd;
              const selected = isStart || isEnd;
              const inRange =
                Boolean(rangeStart && rangeEnd) &&
                key > (rangeStart as string) &&
                key < (rangeEnd as string);

              return (
                <div
                  key={key}
                  role="gridcell"
                  className={cn(
                    'flex justify-center py-0.5',
                    // The band between the ends: a strip on the cell, so it
                    // runs unbroken from one day to the next.
                    (inRange || (selected && rangeStart && rangeEnd && rangeStart !== rangeEnd)) &&
                      'bg-primary/10',
                    isStart && rangeEnd && rangeStart !== rangeEnd && 'rounded-l-full',
                    isEnd && rangeStart && rangeStart !== rangeEnd && 'rounded-r-full',
                  )}
                >
                  <button
                    type="button"
                    data-day={key}
                    tabIndex={key === tabStop ? 0 : -1}
                    aria-label={DAY_FORMAT.format(day)}
                    aria-pressed={selected}
                    aria-current={key === today ? 'date' : undefined}
                    onClick={() => onSelect(key)}
                    onKeyDown={(event) => onKeyDown(event, key)}
                    className={cn(
                      'size-8 cursor-pointer rounded-full text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                      selected
                        ? 'bg-primary font-medium text-primary-foreground'
                        : 'hover:bg-muted',
                      !inMonth && !selected && 'text-muted-foreground/50',
                      key === today && !selected && 'font-semibold text-primary',
                    )}
                  >
                    {day.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
