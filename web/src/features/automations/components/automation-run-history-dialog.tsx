import { AlertCircle, CheckCircle2, Clock3, History, MinusCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';

import type { AutomationRule } from '../api/automations.api';
import { useRuleExecutions } from '../hooks/use-automations';

export function AutomationRunHistoryDialog({
  workspaceId,
  projectId,
  rule,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  projectId: string;
  rule: AutomationRule | null;
  onOpenChange: (open: boolean) => void;
}) {
  const executions = useRuleExecutions(workspaceId, projectId, rule?.id ?? null);

  return (
    <Dialog open={rule !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-primary-strong" aria-hidden="true" />
            Run history
          </DialogTitle>
          <DialogDescription>
            {rule?.name ?? 'Automation'} · newest executions first
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          {executions.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : executions.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Run history could not be loaded. Close this panel and try again.
            </div>
          ) : (executions.data ?? []).length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <Clock3 className="mb-3 size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-semibold">This rule has not run yet</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Publish it, then perform the event named by its trigger. The result and every action
                will appear here.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {(executions.data ?? []).map((execution) => {
                const tone = executionTone(execution.status);
                const StatusIcon = tone.icon;

                return (
                  <li key={execution.id} className="rounded-xl border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`mt-0.5 rounded-full p-1.5 ${tone.iconClass}`}>
                          <StatusIcon className="size-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold capitalize">
                            {execution.status.toLowerCase()}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatRelativeTime(execution.startedAt)}
                            {execution.durationMs !== null ? ` · ${execution.durationMs} ms` : ''}
                          </p>
                        </div>
                      </div>
                      <Badge variant={tone.badge}>
                        {execution.triggerType.replaceAll('_', ' ')}
                      </Badge>
                    </div>

                    {(execution.error || execution.skippedReason) && (
                      <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                        {execution.error ?? execution.skippedReason}
                      </p>
                    )}

                    {execution.logs.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t pt-3">
                        {execution.logs.map((log) => (
                          <li key={log.id} className="flex items-start gap-2 text-xs">
                            {log.succeeded ? (
                              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                            ) : (
                              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                            )}
                            <span>
                              <span className="font-medium">
                                {log.subtype.replaceAll('_', ' ')}
                              </span>
                              {log.message ? ` · ${log.message}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function executionTone(status: string): {
  icon: typeof CheckCircle2;
  iconClass: string;
  badge: 'success' | 'destructive' | 'warning' | 'muted';
} {
  if (status === 'COMPLETED') {
    return { icon: CheckCircle2, iconClass: 'bg-success/10 text-success', badge: 'success' };
  }
  if (status === 'FAILED') {
    return {
      icon: AlertCircle,
      iconClass: 'bg-destructive/10 text-destructive',
      badge: 'destructive',
    };
  }
  if (status === 'RUNNING') {
    return { icon: Clock3, iconClass: 'bg-warning/10 text-warning-strong', badge: 'warning' };
  }
  if (status === 'PARTIALLY_FAILED') {
    return { icon: AlertCircle, iconClass: 'bg-warning/10 text-warning-strong', badge: 'warning' };
  }
  return { icon: MinusCircle, iconClass: 'bg-muted text-muted-foreground', badge: 'muted' };
}
