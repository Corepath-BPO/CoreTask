import {
  AUTOMATION_STATE_COLOR,
  AutomationRuleStatus,
  TRIGGER_LABEL,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  AlertCircle,
  Copy,
  History,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatRelativeTime } from '@/lib/utils';

import type { AutomationRule } from '../api/automations.api';
import { AutomationRunHistoryDialog } from '../components/automation-run-history-dialog';
import {
  useAutomations,
  useDuplicateRule,
  useEnableRule,
  usePauseRule,
  usePublishRule,
  useRemoveRule,
} from '../hooks/use-automations';

/**
 * Every rule on a project, with what it does and how it has been behaving.
 *
 * The run counts are the point: a rule that has never fired and a rule failing
 * every time both look "set up" from a definition alone, and only the history
 * distinguishes them.
 */
export function AutomationsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.MANAGER);

  const { data: rules, isLoading, isError, refetch } = useAutomations(workspaceId, projectId);
  const publish = usePublishRule(workspaceId, projectId);
  const pause = usePauseRule(workspaceId, projectId);
  const enable = useEnableRule(workspaceId, projectId);
  const duplicate = useDuplicateRule(workspaceId, projectId);
  const remove = useRemoveRule(workspaceId, projectId);

  const [pendingRemove, setPendingRemove] = useState<AutomationRule | null>(null);
  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);

  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Automations could not be loaded"
        description="The project is still available. Retry the rule request without leaving this page."
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  if ((rules ?? []).length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="No automations yet"
        description="Rules react to project changes and act automatically, without relying on anyone to remember."
        action={
          canManage ? (
            <Button
              onClick={() =>
                void navigate({
                  to: '/projects/$projectId/automations/new',
                  params: { projectId },
                  search: {},
                })
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              New rule
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() =>
              void navigate({
                to: '/projects/$projectId/automations/new',
                params: { projectId },
                search: {},
              })
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            New rule
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              {['Rule', 'Trigger', 'Status', 'Last run', 'Runs', ''].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-3 py-2 text-xs font-medium text-muted-foreground"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rules ?? []).map((rule) => (
              <tr key={rule.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  {canManage ? (
                    <Button
                      asChild
                      variant="link"
                      className="h-auto justify-start p-0 text-foreground"
                    >
                      <Link
                        to="/projects/$projectId/automations/$ruleId"
                        params={{ projectId, ruleId: rule.id }}
                      >
                        {rule.name}
                      </Link>
                    </Button>
                  ) : (
                    <p className="font-medium text-foreground">{rule.name}</p>
                  )}
                  {rule.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {rule.description}
                    </p>
                  )}
                </td>

                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {TRIGGER_LABEL[rule.triggerType as keyof typeof TRIGGER_LABEL] ??
                    rule.triggerType}
                </td>

                <td className="px-3 py-2">
                  <SemanticBadge
                    color={{
                      colorToken:
                        AUTOMATION_STATE_COLOR[
                          rule.status as keyof typeof AUTOMATION_STATE_COLOR
                        ] ?? 'gray',
                    }}
                  >
                    {rule.status.toLowerCase()}
                  </SemanticBadge>
                </td>

                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {rule.lastRunAt ? formatRelativeTime(rule.lastRunAt) : 'Never'}
                </td>

                <td className="px-3 py-2 text-xs tabular-nums">
                  <button
                    type="button"
                    className="rounded font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setHistoryRule(rule)}
                  >
                    {rule.runCount}
                  </button>
                  {/* Failures are shown beside the total rather than instead of
                      it: "12 runs, 3 failed" is a different story from "3". */}
                  {rule.failureCount > 0 && (
                    <span className="ml-1 text-destructive">({rule.failureCount} failed)</span>
                  )}
                </td>

                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Actions for ${rule.name}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            void navigate({
                              to: '/projects/$projectId/automations/$ruleId',
                              params: { projectId, ruleId: rule.id },
                            })
                          }
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          Edit rule
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setHistoryRule(rule)}>
                          <History className="size-4" aria-hidden="true" />
                          Run history
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {rule.status === AutomationRuleStatus.DRAFT && (
                          <DropdownMenuItem onSelect={() => publish.mutate(rule.id)}>
                            <Upload className="size-4" aria-hidden="true" />
                            Publish
                          </DropdownMenuItem>
                        )}
                        {rule.status === AutomationRuleStatus.ACTIVE && (
                          <DropdownMenuItem onSelect={() => pause.mutate(rule.id)}>
                            <Pause className="size-4" aria-hidden="true" />
                            Pause
                          </DropdownMenuItem>
                        )}
                        {rule.status === AutomationRuleStatus.PAUSED && (
                          <DropdownMenuItem onSelect={() => enable.mutate(rule.id)}>
                            <Play className="size-4" aria-hidden="true" />
                            Resume
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => duplicate.mutate(rule.id)}>
                          <Copy className="size-4" aria-hidden="true" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingRemove(rule)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          {/* Named for what actually happens, which depends on
                              whether the rule has ever run. */}
                          {rule.runCount > 0 ? 'Archive' : 'Delete'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemove && pendingRemove.runCount > 0 ? 'Archive' : 'Delete'} “
              {pendingRemove?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove && pendingRemove.runCount > 0
                ? 'It stops running, and its history stays so you can still see what it changed.'
                : 'This draft has never run, so nothing is lost.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemove) remove.mutate(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              {pendingRemove && pendingRemove.runCount > 0 ? 'Archive' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AutomationRunHistoryDialog
        workspaceId={workspaceId}
        projectId={projectId}
        rule={historyRule}
        onOpenChange={(open) => !open && setHistoryRule(null)}
      />
    </div>
  );
}
