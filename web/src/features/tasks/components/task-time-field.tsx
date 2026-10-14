import { TIME_ENTRY_NOTE_MAX, formatMinutes, parseDuration } from '@coretask/contracts';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { useDeleteTimeEntry, useLogTime, useTaskTime } from '../hooks/use-task-time';

const today = () => new Date().toISOString().slice(0, 10);

/** Where a running timer keeps its start, so closing the pane does not lose it. */
const timerKey = (taskId: string) => `coretask.timer.${taskId}`;

function readTimer(taskId: string): number | null {
  try {
    const raw = window.localStorage.getItem(timerKey(taskId));
    const started = raw ? Number(raw) : NaN;
    return Number.isFinite(started) ? started : null;
  } catch {
    return null;
  }
}

function writeTimer(taskId: string, started: number | null) {
  try {
    if (started === null) window.localStorage.removeItem(timerKey(taskId));
    else window.localStorage.setItem(timerKey(taskId), String(started));
  } catch {
    // Private windows refuse storage; the timer then lives as long as the pane.
  }
}

/** "12:03" or "1:02:09" for a running timer. */
function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Asana's time tracking in the pane: what has been logged against the
 * estimate, a timer, a way to log time by hand, and the entries behind the
 * total. The estimate is set here too, read the way a person writes it.
 */
export function TaskTimeField({
  workspaceId,
  taskId,
  estimatedMinutes,
  canEdit,
  canManage,
  currentUserId,
  onEstimate,
}: {
  workspaceId: string | undefined;
  taskId: string;
  estimatedMinutes: number | null;
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string | undefined;
  onEstimate: (minutes: number | null) => void;
}) {
  const { data: time } = useTaskTime(workspaceId, taskId);
  const log = useLogTime(workspaceId, taskId);
  const remove = useDeleteTimeEntry(workspaceId, taskId);

  const [started, setStarted] = useState<number | null>(() => readTimer(taskId));
  const [now, setNow] = useState(() => Date.now());
  const [showEntries, setShowEntries] = useState(false);

  useEffect(() => {
    if (started === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [started]);

  const total = time?.totalMinutes ?? 0;
  const estimate = estimatedMinutes;
  const over = estimate !== null && total > estimate;
  const entries = time?.entries ?? [];

  const startTimer = () => {
    const at = Date.now();
    writeTimer(taskId, at);
    setStarted(at);
    setNow(at);
  };

  const stopTimer = () => {
    if (started === null) return;
    const minutes = Math.max(1, Math.ceil((Date.now() - started) / 60_000));
    writeTimer(taskId, null);
    setStarted(null);
    log.mutate({ minutes, date: today() });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn('tabular-nums', over && 'font-medium text-destructive')}>
          {formatMinutes(total)} logged
        </span>
        <span className="text-muted-foreground">of</span>
        <EstimateInput estimate={estimate} canEdit={canEdit} onChange={onEstimate} />
        {estimate !== null && (
          <span
            className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${formatMinutes(total)} of ${formatMinutes(estimate)} estimated`}
          >
            <span
              className={cn('block h-full rounded-full', over ? 'bg-destructive' : 'bg-primary')}
              style={{
                width: `${Math.min(100, estimate === 0 ? 100 : (total / estimate) * 100)}%`,
              }}
            />
          </span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-1">
          {started === null ? (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={startTimer}>
              <Play />
              Start timer
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={stopTimer}>
              <Pause />
              <span className="tabular-nums" aria-live="off">
                Stop {clock(now - started)}
              </span>
            </Button>
          )}
          <LogTimePopover
            pending={log.isPending}
            onLog={(payload, done) => log.mutate(payload, { onSuccess: done })}
          />
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              aria-expanded={showEntries}
              onClick={() => setShowEntries((open) => !open)}
            >
              {showEntries ? 'Hide' : 'Show'} {entries.length}{' '}
              {entries.length === 1 ? 'entry' : 'entries'}
            </Button>
          )}
        </div>
      )}

      {showEntries && entries.length > 0 && (
        <ul className="space-y-1 rounded-md border p-2 text-xs">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{entry.date}</span>
              <span className="w-24 shrink-0 truncate">{entry.user?.name ?? 'Former member'}</span>
              <span className="w-14 shrink-0 font-medium tabular-nums">
                {formatMinutes(entry.minutes)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.note}</span>
              {(canManage || entry.user?.id === currentUserId) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={`Remove ${formatMinutes(entry.minutes)} logged on ${entry.date}`}
                  onClick={() => remove.mutate(entry.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The estimate, edited in place: "2h", "90", "1h 30m"; empty clears it. */
function EstimateInput({
  estimate,
  canEdit,
  onChange,
}: {
  estimate: number | null;
  canEdit: boolean;
  onChange: (minutes: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => {
          setDraft(estimate === null ? '' : formatMinutes(estimate));
          setEditing(true);
        }}
        className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:hover:bg-transparent"
      >
        {estimate === null ? 'no estimate' : `${formatMinutes(estimate)} estimated`}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const text = draft.trim();
    if (text === '') {
      if (estimate !== null) onChange(null);
      return;
    }
    const minutes = parseDuration(text);
    if (minutes !== null && minutes !== estimate) onChange(minutes);
  };

  return (
    <Input
      aria-label="Estimate"
      value={draft}
      autoFocus
      placeholder="e.g. 2h"
      className="h-7 w-24 text-sm"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

function LogTimePopover({
  pending,
  onLog,
}: {
  pending: boolean;
  onLog: (
    payload: { minutes: number; date: string; note: string | null },
    done: () => void,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');

  const minutes = parseDuration(duration);
  const ready = minutes !== null && !pending;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDuration('');
          setDate(today());
          setNote('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Plus />
          Log time
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || minutes === null) return;
            onLog({ minutes, date, note: note.trim() || null }, () => setOpen(false));
          }}
        >
          <div className="space-y-1">
            <label htmlFor="log-duration" className="text-xs font-medium">
              Time spent
            </label>
            <Input
              id="log-duration"
              value={duration}
              autoFocus
              placeholder="e.g. 1h 30m"
              onChange={(event) => setDuration(event.target.value)}
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {duration.trim() === ''
                ? 'Minutes, or hours and minutes.'
                : minutes === null
                  ? 'That is not a duration.'
                  : formatMinutes(minutes)}
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="log-date" className="text-xs font-medium">
              Day
            </label>
            <Input
              id="log-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="log-note" className="text-xs font-medium">
              Note
            </label>
            <Input
              id="log-note"
              value={note}
              maxLength={TIME_ENTRY_NOTE_MAX}
              placeholder="What was it spent on?"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!ready}>
              Log time
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
