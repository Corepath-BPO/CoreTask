import { useNavigate } from '@tanstack/react-router';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { cn } from '@/lib/utils';

import { buildImportPlan, type ImportPlan } from '../lib/asana-import';
import {
  FAST_SPACING_MS,
  estimateDurationBoundsMs,
  estimateRequestCount,
  runImport,
  type ImportProgress,
  type ImportRunResult,
} from '../lib/import-runner';
import { parseCsv } from '../lib/parse-csv';

/** An Asana export is ~1MB; anything enormous is the wrong file. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const COLUMN_TYPE_LABEL: Record<string, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  SINGLE_SELECT: 'Single select',
};

type DialogState =
  | { step: 'pick'; error: string | null }
  | {
      step: 'preview';
      fileName: string;
      plan: ImportPlan;
      projectName: string;
      includedColumns: boolean[];
    }
  | {
      step: 'running';
      plan: ImportPlan;
      progress: ImportProgress;
      controller: AbortController;
      confirmingCancel: boolean;
    }
  | { step: 'done'; result: ImportRunResult };

const INITIAL: DialogState = { step: 'pick', error: null };

function formatEta(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes === 1) return 'about 1 minute';
  return `about ${minutes} minutes`;
}

/** "4–25 minutes" — the spread between never-throttled and throttled pace. */
function formatEtaRange(fastMs: number, safeMs: number): string {
  const safeMinutes = Math.round(safeMs / 60_000);
  if (safeMinutes < 1) return 'under a minute';
  const fastMinutes = Math.max(1, Math.round(fastMs / 60_000));
  if (fastMinutes >= safeMinutes) return formatEta(safeMs);
  return `${fastMinutes}–${safeMinutes} minutes`;
}

/**
 * Imports an Asana CSV export as a new project: pick a file, review what it
 * contains, watch the paced run, open the result.
 *
 * Every task and every field value is its own request, so the duration is set
 * by the server's rate limit — the runner starts fast and settles to a safe
 * pace only if throttled. This dialog's job is to make the cost honest up
 * front (the preview's range) rather than surprising anyone mid-way.
 */
export function ImportProjectDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
}) {
  const [state, setState] = useState<DialogState>(INITIAL);
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();

  const { data: members } = useWorkspaceMembers(workspaceId);
  const membersByEmail = useMemo(
    () =>
      new Map((members ?? []).map((member) => [member.user.email.toLowerCase(), member.user.id])),
    [members],
  );

  const running = state.step === 'running';

  // A refresh mid-import loses the run (the created items survive). The
  // browser prompt is the only honest guard there is.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const close = (next: boolean) => {
    // While importing, the only exit is the Cancel button — dismissing the
    // dialog would leave a run nobody can see or stop.
    if (!next && running) return;
    if (!next) setState(INITIAL);
    onOpenChange(next);
  };

  const acceptFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setState({ step: 'pick', error: 'That file is over 20 MB — it does not look like a project export.' });
      return;
    }
    try {
      const text = await file.text();
      const plan = buildImportPlan(parseCsv(text), { membersByEmail, fileName: file.name });
      setState({
        step: 'preview',
        fileName: file.name,
        plan,
        projectName: plan.projectName,
        includedColumns: plan.customFieldColumns.map(() => true),
      });
    } catch (error) {
      setState({
        step: 'pick',
        error: error instanceof Error ? error.message : 'The file could not be read.',
      });
    }
  };

  const startImport = () => {
    if (state.step !== 'preview' || !workspaceId) return;
    const { plan, projectName, includedColumns } = state;
    const controller = new AbortController();

    setState({
      step: 'running',
      plan,
      controller,
      confirmingCancel: false,
      progress: {
        phase: 'project',
        done: 0,
        total: estimateRequestCount(plan, includedColumns),
        currentLabel: 'Starting…',
        spacingMs: FAST_SPACING_MS,
      },
    });

    void runImport({
      plan,
      workspaceId,
      projectName: projectName.trim(),
      includedColumns,
      signal: controller.signal,
      onProgress: (progress) =>
        setState((current) =>
          current.step === 'running' ? { ...current, progress } : current,
        ),
    }).then((result) => {
      // The list page should show the new project the moment this closes.
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) });
      setState({ step: 'done', result });
    });
  };

  const openProject = (projectId: string) => {
    setState(INITIAL);
    onOpenChange(false);
    void navigate({ to: '/projects/$projectId/list', params: { projectId } });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>Import a project from CSV</DialogTitle>
          <DialogDescription>
            Bring an Asana export in as a new project — sections, tasks, subtasks and fields.
          </DialogDescription>
        </DialogHeader>

        {state.step === 'pick' && (
          <div className="space-y-3">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) void acceptFile(file);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm">
                Drop a CSV file here, or{' '}
                <label className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
                  browse
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // Reset so re-picking the same file fires again.
                      event.target.value = '';
                      if (file) void acceptFile(file);
                    }}
                  />
                </label>
              </p>
              <p className="text-xs text-muted-foreground">
                Asana: Project actions → Export → CSV
              </p>
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          </div>
        )}

        {state.step === 'preview' && (
          <PreviewStep
            state={state}
            onBack={() => setState(INITIAL)}
            onChange={(next) => setState(next)}
            onImport={startImport}
          />
        )}

        {state.step === 'running' && (
          <div className="space-y-4">
            <Progress value={(state.progress.done / Math.max(1, state.progress.total)) * 100} />
            <div className="space-y-1 text-sm">
              <p className="truncate text-muted-foreground">{state.progress.currentLabel}</p>
              <p>
                {state.progress.done.toLocaleString()} of {state.progress.total.toLocaleString()}{' '}
                <span className="text-muted-foreground">
                  {/* Multiplied by the *current* pace, so being throttled
                      shows up as a longer ETA instead of a lie. */}
                  ·{' '}
                  {formatEta(
                    (state.progress.total - state.progress.done) * state.progress.spacingMs,
                  )}{' '}
                  left
                </span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Keep this tab open — the import runs in your browser.
            </p>
            <div className="flex justify-end">
              <Button
                variant={state.confirmingCancel ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => {
                  if (state.confirmingCancel) {
                    state.controller.abort();
                  } else {
                    setState({ ...state, confirmingCancel: true });
                  }
                }}
              >
                {state.confirmingCancel ? 'Cancel import?' : 'Cancel'}
              </Button>
            </div>
          </div>
        )}

        {state.step === 'done' && (
          <div className="space-y-4">
            <p className="text-sm">
              {state.result.cancelled
                ? 'Import cancelled — everything created before the cancel was kept.'
                : state.result.projectId
                  ? 'Import finished.'
                  : 'The import could not run.'}
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                {state.result.createdTasks.toLocaleString()} tasks,{' '}
                {state.result.createdSubtasks.toLocaleString()} subtasks,{' '}
                {state.result.createdSections} sections
              </li>
              {state.result.createdFields > 0 && (
                <li>
                  {state.result.createdFields} fields · {state.result.valuesSet.toLocaleString()}{' '}
                  values filled in
                </li>
              )}
            </ul>
            {state.result.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {state.result.errors.length} item{state.result.errors.length === 1 ? '' : 's'}{' '}
                  could not be imported
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2 text-xs text-muted-foreground">
                  {state.result.errors.map((error, index) => (
                    <li key={index}>
                      {error.rowIndex !== null && (
                        <span className="tabular-nums">row {error.rowIndex}: </span>
                      )}
                      <span className="text-foreground">{error.label}</span> — {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>
                Close
              </Button>
              {state.result.projectId && (
                <Button onClick={() => openProject(state.result.projectId as string)}>
                  Open project
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewStep({
  state,
  onBack,
  onChange,
  onImport,
}: {
  state: Extract<DialogState, { step: 'preview' }>;
  onBack: () => void;
  onChange: (next: Extract<DialogState, { step: 'preview' }>) => void;
  onImport: () => void;
}) {
  const { plan, projectName, includedColumns, fileName } = state;
  const nameValid = projectName.trim().length >= 2 && projectName.trim().length <= 120;
  const requestCount = estimateRequestCount(plan, includedColumns);
  const { fastMs, safeMs } = estimateDurationBoundsMs(plan, includedColumns);

  const shownWarnings = plan.warnings.slice(0, 8);
  const warningsRef = useRef<HTMLUListElement>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{fileName}</span>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="import-project-name">
          Project name
        </label>
        <Input
          id="import-project-name"
          value={projectName}
          onChange={(event) => onChange({ ...state, projectName: event.target.value })}
          aria-invalid={!nameValid}
        />
      </div>

      <ul className="space-y-1 text-sm">
        <li>
          {plan.stats.topLevel.toLocaleString()} tasks · {plan.stats.subtasks.toLocaleString()}{' '}
          subtasks · {plan.sections.length} sections
        </li>
        <li className="text-muted-foreground">
          {plan.stats.assigneesMatched.toLocaleString()} assignees matched
          {plan.stats.assigneesUnmatched > 0 && (
            <>
              {' · '}
              <span title={plan.stats.unmatchedEmails.join(', ')}>
                {plan.stats.assigneesUnmatched.toLocaleString()} unmatched (left unassigned)
              </span>
            </>
          )}
        </li>
      </ul>

      {plan.customFieldColumns.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Custom fields to import</legend>
          {plan.customFieldColumns.map((column, index) => (
            <label
              key={column.header}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={includedColumns[index] ?? false}
                onChange={(event) => {
                  const next = [...includedColumns];
                  next[index] = event.target.checked;
                  onChange({ ...state, includedColumns: next });
                }}
                className="size-4 cursor-pointer rounded border-input accent-primary"
              />
              <span className="min-w-0 truncate">{column.header}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {COLUMN_TYPE_LABEL[column.type]}
                {column.options ? ` (${column.options.length} options)` : ''} ·{' '}
                {column.nonEmptyCount.toLocaleString()} values
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {shownWarnings.length > 0 && (
        <ul
          ref={warningsRef}
          className="max-h-28 space-y-0.5 overflow-y-auto rounded-md border border-border/60 p-2 text-xs text-muted-foreground"
        >
          {shownWarnings.map((warning, index) => (
            <li key={index}>
              {warning.rowIndex !== null && <span>row {warning.rowIndex}: </span>}
              {warning.message}
            </li>
          ))}
          {plan.warnings.length > shownWarnings.length && (
            <li>…and {plan.warnings.length - shownWarnings.length} more</li>
          )}
        </ul>
      )}

      {plan.blockingError && <p className="text-sm text-destructive">{plan.blockingError}</p>}

      <div className="flex items-center justify-between gap-3">
        {/* A range because the server's rate limit decides which end holds —
            better said here than discovered at 40%. */}
        <p className="text-xs text-muted-foreground">
          ≈ {requestCount.toLocaleString()} requests · {formatEtaRange(fastMs, safeMs)}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button
            onClick={onImport}
            disabled={!nameValid || plan.blockingError !== null || plan.tasks.length === 0}
          >
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}
