import { TaskStatus } from '@coretask/contracts';
import { AlertTriangle, CheckCircle2, Circle, RotateCcw } from 'lucide-react';

import { CopyButton } from '@/components/common/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { PlaygroundResponse } from '../../hooks/use-playground';

interface ResponsePanelProps {
  response: PlaygroundResponse | undefined;
  error: unknown;
  pending: boolean;
  /** When the answer is a list, each row gets a button that hands its id to this field. */
  pick?: { label: string; onPick: (id: string) => void };
}

interface ListedRecord {
  id: string;
  name: string;
  status: string | null;
}

/** The rows of a list answer, reduced to what a person picks by: a name and a state. */
function listedRecords(body: unknown): ListedRecord[] | null {
  const data =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) return null;

  const records: ListedRecord[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { id, title, name, status } = item as Record<string, unknown>;
    if (typeof id !== 'string') continue;
    records.push({
      id,
      name: typeof title === 'string' ? title : typeof name === 'string' ? name : id,
      status: typeof status === 'string' ? status : null,
    });
  }
  return records;
}

/** The answer, whole, with the two things worth pointing at: the status and any new id. */
export function ResponsePanel({ response, error, pending, pick }: ResponsePanelProps) {
  const records = pick && response?.ok ? listedRecords(response.body) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Response</CardTitle>
        <CardDescription>The real answer from the API, as a tool would receive it.</CardDescription>
      </CardHeader>
      <CardContent>
        {pending ? (
          <Skeleton className="h-24 rounded-md" />
        ) : error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              The request never got an answer. Check that the API is running and that the address
              above is reachable from this browser.
            </span>
          </div>
        ) : response ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill status={response.status} />
              <span className="tabular-nums text-muted-foreground">{response.durationMs} ms</span>
              {response.headers.replayed && (
                <Badge variant="outline" className="gap-1">
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Replayed from an earlier run
                </Badge>
              )}
              {response.createdId && (
                <span className="ml-auto flex items-center gap-1">
                  <code className="font-mono text-muted-foreground">id: {response.createdId}</code>
                  <CopyButton
                    value={response.createdId}
                    label="Copy the returned id"
                    successMessage="ID copied"
                    size="icon-sm"
                    variant="ghost"
                  />
                </span>
              )}
            </div>

            {pick && records && (
              <PickList records={records} label={pick.label} onPick={pick.onPick} />
            )}

            <pre
              className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed"
              data-testid="playground-response"
            >
              {typeof response.body === 'string'
                ? response.body
                : JSON.stringify(response.body, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Fill in the call on the left and press Run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The list answer as rows to choose from, above the raw JSON: a subtask's
 * title and whether it is done, a section's name. One press fills the field
 * the next call needs, which is the whole point of listing them here.
 */
function PickList({
  records,
  label,
  onPick,
}: {
  records: ListedRecord[];
  label: string;
  onPick: (id: string) => void;
}) {
  if (records.length === 0) {
    return <p className="text-xs text-muted-foreground">The list is empty: nothing to pick.</p>;
  }

  return (
    <ul aria-label={`Pick one to use as ${label}`} className="divide-y rounded-md border text-sm">
      {records.map((record) => (
        <li key={record.id} className="flex items-center gap-2 px-3 py-1.5">
          {record.status !== null &&
            (record.status === TaskStatus.DONE ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Done" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Not done" />
            ))}
          <span className="min-w-0 flex-1 truncate">{record.name}</span>
          {record.status !== null && (
            <span className="font-mono text-[10px] text-muted-foreground">{record.status}</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Use ${record.name} as ${label}`}
            onClick={() => onPick(record.id)}
          >
            Use
          </Button>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: number }) {
  const tone =
    status < 300
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : status < 500
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : 'bg-destructive/15 text-destructive';

  return (
    <span
      className={cn('rounded-md px-2 py-0.5 font-mono text-xs font-semibold', tone)}
      aria-label={`HTTP ${status}`}
    >
      {status}
    </span>
  );
}
