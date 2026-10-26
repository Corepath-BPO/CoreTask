import { CalendarSync, Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import {
  useCalendarFeed,
  useCreateCalendarFeed,
  useResetCalendarFeed,
  useStopCalendarFeed,
} from '../hooks/use-calendar-feed';

interface CalendarSyncDialogProps {
  workspaceId: string;
  /** Null: the caller's My Tasks. */
  projectId: string | null;
  /** What is being synced, for the title: "My Tasks", or the project's name. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Asana's "Sync to calendar": a private iCalendar link to paste into Google
 * Calendar, Outlook or Apple Calendar, after which tasks with due dates show
 * up there and keep up as they change.
 */
export function CalendarSyncDialog({
  workspaceId,
  projectId,
  label,
  open,
  onOpenChange,
}: CalendarSyncDialogProps) {
  const { data: feed, isLoading } = useCalendarFeed(open ? workspaceId : undefined, projectId);
  const create = useCreateCalendarFeed(workspaceId, projectId);
  const reset = useResetCalendarFeed(workspaceId, projectId);
  const stop = useStopCalendarFeed(workspaceId, projectId);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The address is selectable in the box; copying by hand still works.
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmReset(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync {label} to your calendar</DialogTitle>
          <DialogDescription>
            Tasks with a due date show up in Google Calendar, Outlook or Apple Calendar, and follow
            along as dates change. Calendar apps refresh on their own schedule, often every few
            hours.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : feed ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                readOnly
                value={feed.url}
                aria-label="Calendar link"
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" onClick={() => copy(feed.url)}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                In Google Calendar: Other calendars › <strong>From URL</strong>, then paste.
              </li>
              <li>
                In Outlook: Add calendar › <strong>Subscribe from web</strong>, then paste.
              </li>
              <li>
                In Apple Calendar: File › <strong>New Calendar Subscription</strong>, or{' '}
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href={feed.url.replace(/^https?:/, 'webcal:')}
                >
                  open it directly
                </a>
                .
              </li>
            </ol>
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Anyone with this link can see these tasks. Keep it to yourself; if it gets out, reset
              it.
            </p>
            {confirmReset && (
              <p role="alert" className="text-sm text-destructive">
                The current link stops working, and calendars subscribed to it stop updating.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CalendarSync className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Make a private link to subscribe to from your calendar app.
            </p>
            <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
              Make a calendar link
            </Button>
          </div>
        )}

        {feed && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
            >
              Stop syncing
            </Button>
            <Button
              type="button"
              variant={confirmReset ? 'destructive' : 'outline'}
              disabled={reset.isPending}
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                reset.mutate(undefined, { onSettled: () => setConfirmReset(false) });
              }}
            >
              {confirmReset ? 'Reset the link' : 'Reset link'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
