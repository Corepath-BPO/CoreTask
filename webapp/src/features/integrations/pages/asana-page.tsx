import type { ImportRunStatus } from '@coretask/contracts';
import type { ImportCounter, ImportRun } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRightLeft, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { useAsanaImportStatus, useStartAsanaImport } from '../hooks/use-asana-import';
import { isRunActive } from '../lib/import-runs';

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const numberFormat = new Intl.NumberFormat();

const STATUS_LABEL: Record<ImportRunStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Done',
  PARTIAL: 'Done, with gaps',
  FAILED: 'Failed',
};

const STATUS_VARIANT: Record<
  ImportRunStatus,
  'muted' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  QUEUED: 'muted',
  RUNNING: 'secondary',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
};

const PHASE_LABEL: Record<string, string> = {
  starting: 'Starting',
  people: 'Matching people',
  teams: 'Teams',
  fields: 'Custom fields',
  tags: 'Tags',
  projects: 'Projects and sections',
  portfolios: 'Portfolios',
  tasks: 'Tasks',
  subtasks: 'Subtasks',
  history: 'Comments and files',
  dependencies: 'Dependencies',
  access: 'Project access',
  done: 'Finished',
};

/** The bars a running import shows, in the order its phases reach them. */
const BARS: { key: string; label: string }[] = [
  { key: 'projects', label: 'Projects' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'subtasks', label: 'Subtasks' },
  { key: 'history', label: 'Comments and files checked' },
];

/** Counters worth a number in the summary line, and what to call them. */
const TALLIES: { key: string; one: string; many: string }[] = [
  { key: 'people', one: 'person', many: 'people' },
  { key: 'placeholders', one: 'new placeholder account', many: 'new placeholder accounts' },
  {
    key: 'subtasksInProjects',
    one: 'subtask also in a project',
    many: 'subtasks also in a project',
  },
  { key: 'textShortened', one: 'long text value shortened', many: 'long text values shortened' },
  { key: 'teams', one: 'team', many: 'teams' },
  { key: 'customFields', one: 'custom field', many: 'custom fields' },
  { key: 'sections', one: 'section', many: 'sections' },
  { key: 'comments', one: 'comment', many: 'comments' },
  { key: 'attachments', one: 'file', many: 'files' },
  { key: 'links', one: 'linked file', many: 'linked files' },
  { key: 'emptyFiles', one: 'empty file skipped', many: 'empty files skipped' },
  { key: 'flattened', one: 'nested subtask moved up', many: 'nested subtasks moved up' },
];

function counter(run: ImportRun, key: string): ImportCounter | null {
  const value = run.counts[key];
  return typeof value === 'object' && value !== null ? value : null;
}

/**
 * Integrations › Asana: brings an Asana organisation into CoreTask.
 *
 * The first import makes a new workspace, so nothing already here changes;
 * later runs are started from that workspace and update what the first made.
 * Asana itself is only ever read.
 */
export function AsanaPage() {
  const { workspace, select } = useActiveWorkspace();
  const navigate = useNavigate();
  const { data: status, isLoading } = useAsanaImportStatus(workspace?.id);
  const start = useStartAsanaImport(workspace?.id);
  const [confirming, setConfirming] = useState(false);

  if (isLoading || !status) {
    return (
      <div role="status" className="max-w-3xl space-y-3">
        <span className="sr-only">Loading Asana</span>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const active = isRunActive(status);
  const asanaName = status.asanaWorkspace?.name ?? 'Asana';
  const openTarget = () => {
    if (!status.target) return;
    select(status.target.id);
    void navigate({ to: '/integrations/asana' });
  };

  return (
    <section className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Asana</h2>
        <p className="text-sm text-muted-foreground">
          Bring Asana’s projects, sections, tasks, subtasks, custom fields, comments and files into
          CoreTask. Asana is only read, never changed.
        </p>
      </div>

      {!status.configured ? (
        <EmptyState
          icon={Settings2}
          title="Asana is not set up on this server"
          description={`Whoever runs this CoreTask server adds ${status.missing.join(' and ')} to the server’s settings. The steps are in docs/integrations/asana-import.md.`}
        />
      ) : !status.asanaWorkspace || !status.eligible ? (
        <Card>
          <CardContent className="space-y-1 py-5">
            <p className="font-medium">You can’t import from Asana</p>
            <p className="text-sm text-muted-foreground">{status.reason}</p>
          </CardContent>
        </Card>
      ) : status.target && !status.isTarget ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                {asanaName} is imported into {status.target.name}
              </p>
              <p className="text-sm text-muted-foreground">
                Progress, and syncing again, live in that workspace.
              </p>
            </div>
            <Button variant="outline" onClick={openTarget}>
              Open {status.target.name}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                {status.isTarget
                  ? `This workspace holds the import of ${asanaName}`
                  : `Import ${asanaName} into a new workspace`}
              </p>
              <p className="text-sm text-muted-foreground">
                {status.isTarget
                  ? 'Syncing again updates what was imported and adds what is new in Asana. Comments and tasks added here are kept.'
                  : 'A new workspace is made for it, owned by you, so nothing already in CoreTask changes.'}
              </p>
            </div>
            <Button disabled={active || start.isPending} onClick={() => setConfirming(true)}>
              <ArrowRightLeft className="size-4" aria-hidden="true" />
              {status.isTarget ? 'Sync again' : 'Import from Asana'}
            </Button>
          </CardContent>
        </Card>
      )}

      {status.runs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Runs</h3>
          <RunCard run={status.runs[0] as ImportRun} />
          {status.runs.length > 1 && (
            <ul className="divide-y rounded-lg border text-sm">
              {status.runs.slice(1).map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{dateTimeFormat.format(new Date(run.createdAt))}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {run.errorCount > 0 && `${numberFormat.format(run.errorCount)} not imported`}
                    <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_LABEL[run.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {status.isTarget ? `Sync ${asanaName} again?` : `Import ${asanaName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Every project, task and subtask is read from Asana; a large organisation takes an
                  hour or more. You can leave this page while it runs.
                </p>
                <p>
                  People are matched by e-mail. Anyone without a CoreTask account gets one with no
                  password, which they claim by signing in with Google or Microsoft at that address,
                  or with “Forgot password”. Nobody is notified, and no rules run on imported tasks.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={start.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending}
              onClick={() => start.mutate(undefined, { onSettled: () => setConfirming(false) })}
            >
              {status.isTarget ? 'Sync again' : 'Import'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** The newest run, in full: where it is, how far, and what did not come across. */
function RunCard({ run }: { run: ImportRun }) {
  const [showAll, setShowAll] = useState(false);
  const running = run.status === 'QUEUED' || run.status === 'RUNNING';
  const tallies = TALLIES.flatMap(({ key, one, many }) => {
    const value = counter(run, key)?.done ?? 0;
    return value > 0 ? [`${numberFormat.format(value)} ${value === 1 ? one : many}`] : [];
  });
  const requests = typeof run.counts['requests'] === 'number' ? run.counts['requests'] : null;
  const errors = showAll ? run.errors : run.errors.slice(0, 10);

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="font-medium">
              {running
                ? (PHASE_LABEL[run.phase ?? 'starting'] ?? run.phase)
                : `Finished ${run.finishedAt ? dateTimeFormat.format(new Date(run.finishedAt)) : ''}`}
            </p>
            <p className="text-xs text-muted-foreground">
              Started {dateTimeFormat.format(new Date(run.startedAt ?? run.createdAt))}
              {run.startedBy ? ` by ${run.startedBy.name}` : ''}
              {requests !== null ? ` · ${numberFormat.format(requests)} Asana requests` : ''}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_LABEL[run.status]}</Badge>
        </div>

        <div className="space-y-3">
          {BARS.map(({ key, label }) => {
            const value = counter(run, key);
            if (!value) return null;
            const total = Math.max(value.total ?? value.done, value.done);
            const percent = total > 0 ? Math.round((value.done / total) * 100) : 100;
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {numberFormat.format(value.done)}
                    {value.total !== undefined ? ` of ${numberFormat.format(total)}` : ''}
                  </span>
                </div>
                <Progress value={percent} aria-label={`${label}: ${percent}%`} />
              </div>
            );
          })}
        </div>

        {tallies.length > 0 && (
          <p className="text-sm text-muted-foreground">{tallies.join(' · ')}</p>
        )}

        {run.errorCount > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {numberFormat.format(run.errorCount)} {run.errorCount === 1 ? 'record' : 'records'}{' '}
              not imported
            </p>
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
              {errors.map((error, index) => (
                <li key={`${error.externalId ?? 'run'}-${index}`} className="break-words">
                  <span className="font-medium">{error.kind}</span>
                  {error.name ? ` · ${error.name}` : ''}: {error.message}
                </li>
              ))}
            </ul>
            {run.errors.length > 10 && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Show fewer' : `Show all ${run.errors.length}`}
              </Button>
            )}
            {run.errorCount > run.errors.length && (
              <p className="text-xs text-muted-foreground">
                Only the first {run.errors.length} are listed; the worker log has the rest.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
