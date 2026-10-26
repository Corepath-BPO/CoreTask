import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { env } from '@/app/config/env';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { getAccessToken } from '@/lib/api/client';
import { cn } from '@/lib/utils';

import { CallForm } from '../components/playground/call-form';
import {
  CredentialPicker,
  type CredentialChoice,
} from '../components/playground/credential-picker';
import { ExportPanel } from '../components/playground/export-panel';
import { RequestPreview } from '../components/playground/request-preview';
import { ResponsePanel } from '../components/playground/response-panel';
import { usePlaygroundRun } from '../hooks/use-playground';
import {
  PLAYGROUND_CALLS,
  buildRequest,
  missingFields,
  playgroundCall,
  type PlaygroundCallId,
  type PlaygroundCredential,
  type PlaygroundHandoff,
  type PlaygroundValues,
} from '../lib/playground-calls';

/**
 * The pasted key survives a reload of this tab and nothing more. Session
 * storage, not local: it dies with the tab, and no other tab can read it.
 */
const KEY_STORAGE = 'coretask.playground.apiKey';

function readStoredKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function storeKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked: the key simply does not survive a reload.
  }
}

const newIdempotencyKey = () => `playground-${crypto.randomUUID()}`;

/**
 * A guided way to try the API from the browser: pick a call, fill it from
 * dropdowns, run it, read the answer, take the request away as curl or as an
 * n8n node. Everything it does is real — the task it creates is a real task.
 */
export function PlaygroundPage() {
  const { workspace } = useActiveWorkspace();
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  const [callId, setCallId] = useState<PlaygroundCallId>('whoami');
  const [values, setValues] = useState<PlaygroundValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [credential, setCredential] = useState<CredentialChoice>(() => {
    const stored = readStoredKey();
    return stored ? { kind: 'api-key', key: stored } : { kind: 'session' };
  });
  const [idempotencyOn, setIdempotencyOn] = useState(true);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [handoff, setHandoff] = useState<PlaygroundHandoff>({});

  const run = usePlaygroundRun();
  const call = playgroundCall(callId);

  useEffect(() => {
    storeKey(credential.kind === 'api-key' ? credential.key : '');
  }, [credential]);

  const resolvedCredential: PlaygroundCredential =
    credential.kind === 'api-key' ? credential : { kind: 'session', token: getAccessToken() };

  const request = useMemo(
    () =>
      workspace
        ? buildRequest({
            call,
            apiUrl: env.apiUrl,
            workspaceId: workspace.id,
            values,
            credential: resolvedCredential,
            idempotencyKey: idempotencyOn ? idempotencyKey : null,
          })
        : null,
    // The credential object is rebuilt each render; its fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call, workspace?.id, values, credential, idempotencyOn, idempotencyKey],
  );

  if (!workspace || !canManage || !request) return null;

  const setValue = (key: string, value: string) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      // A different project means the section chosen for the old one is wrong.
      if (key === 'projectId' && current['projectId'] !== value) next['sectionId'] = '';
      return next;
    });
    setErrors((current) => {
      if (!current[key]) return current;
      const { [key]: _cleared, ...rest } = current;
      return rest;
    });
  };

  const pickCall = (next: PlaygroundCallId) => {
    setCallId(next);
    setErrors({});
    run.reset();
  };

  const execute = () => {
    if (credential.kind === 'api-key' && !credential.key.trim()) {
      toast.error('Paste an API key, or switch to running as yourself.');
      return;
    }
    const missing = missingFields(call, values);
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;

    run.mutate(request, {
      onSuccess: (response) => {
        if (!response.ok || !response.createdId) return;
        const id = response.createdId;

        // Hand the new id to the calls that want one, so "complete it" is a click away.
        if (call.produces === 'taskId') {
          // A new task is also the parent the subtask calls will want.
          setHandoff({ taskId: id, parentTaskId: id });
          setValues((current) => ({ ...current, taskId: id, parentTaskId: id }));
          toast.success('Task created — its id is filled in for the next call');
        } else if (call.produces === 'subtaskId') {
          // The subtask becomes the task to act on; its parent stays selected.
          setHandoff((current) => ({ ...current, taskId: id }));
          setValues((current) => ({ ...current, taskId: id }));
          toast.success('Subtask created — Complete a task now ticks it off');
        }
      },
    });
  };

  const picks = call.picks;
  const pick = picks
    ? {
        label: picks.label,
        onPick: (id: string) => {
          setValue(picks.key, id);
          toast.success(`${picks.label} filled in for the next call`);
        },
      }
    : undefined;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Playground</h2>
          <p className="text-sm text-muted-foreground">
            Try the calls a tool like n8n makes, with the ids filled in for you. Everything here is
            real: a task you create appears in the project.
          </p>
        </div>

        <CredentialPicker value={credential} onChange={setCredential} />

        <div role="group" aria-label="Calls" className="grid gap-1.5 sm:grid-cols-2">
          {PLAYGROUND_CALLS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === callId}
              onClick={() => pickCall(candidate.id)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                candidate.id === callId
                  ? 'border-primary/60 bg-primary/5 font-medium'
                  : 'border-border hover:bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'w-12 shrink-0 font-mono text-[11px]',
                  candidate.id === callId ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {candidate.method}
              </span>
              {candidate.label}
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{call.label}</CardTitle>
            <p className="text-sm text-muted-foreground">{call.description}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <CallForm
              call={call}
              workspaceId={workspace.id}
              values={values}
              errors={errors}
              onChange={setValue}
              handoff={handoff}
            />

            {call.idempotent && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="playground-idempotency"
                    checked={idempotencyOn}
                    onCheckedChange={(checked) => setIdempotencyOn(checked === true)}
                  />
                  <Label htmlFor="playground-idempotency" className="text-sm">
                    Send an Idempotency-Key
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={!idempotencyOn}
                    onClick={() => setIdempotencyKey(newIdempotencyKey())}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    New key
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Run twice with the same key and the second run gets the first answer back instead
                  of a second record. Press New key to create for real again.
                </p>
              </div>
            )}

            <Button onClick={execute} loading={run.isPending} className="w-full sm:w-auto">
              <Play className="size-4" aria-hidden="true" />
              Run
            </Button>
          </CardContent>
        </Card>
      </section>

      {/*
        On wide screens the answer column is pinned, so pressing Run at the
        bottom of a long form never scrolls the response out of view. It keeps
        the page's 1.5rem gutter below the 4rem top bar and above the bottom
        edge, and scrolls on its own when the three cards outgrow that height
        — the mouse wheel stays inside it until it reaches the end. `self-start`
        because a stretched grid item has nowhere to stick.
      */}
      <section
        aria-label="Result"
        className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:overscroll-y-contain"
      >
        <RequestPreview request={request} />
        <ResponsePanel response={run.data} error={run.error} pending={run.isPending} pick={pick} />
        <ExportPanel request={request} call={call} />
      </section>
    </div>
  );
}
