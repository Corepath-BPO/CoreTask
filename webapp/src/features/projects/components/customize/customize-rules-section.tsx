import { AutomationExecutionStatus, AutomationRuleStatus } from '@coretask/contracts';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AutomationRule } from '@/features/automations/api/automations.api';
import { RuleActionsMenu } from '@/features/automations/components/rule-actions-menu';
import { TriggerIcon } from '@/features/automations/components/trigger-icon';
import { useRuleActions } from '@/features/automations/hooks/use-rule-actions';
import { cn, formatRelativeTime } from '@/lib/utils';

const STATE_LABEL: Partial<Record<string, string>> = {
  [AutomationRuleStatus.ACTIVE]: 'Active',
  [AutomationRuleStatus.PAUSED]: 'Paused',
  [AutomationRuleStatus.DRAFT]: 'Draft',
  [AutomationRuleStatus.DISABLED]: 'Off',
};

/**
 * The project's rules, listed inside the Customize panel the way Asana lists
 * its automations: "In this project" with + Add, then one row per rule with
 * what sets it off, its name, and whether it is on and when it last ran.
 *
 * A directory rather than a second rule editor: each row hands off to the
 * builder, which already owns editing, and + Add opens the Add automation page
 * the Automations tab opens. Both navigate with a fresh search, which drops
 * `?customize=` — the panel gives way, and closing the page brings it back.
 */
export function CustomizeRulesSection({
  workspaceId,
  projectId,
  rules,
  isLoading,
  canManage,
}: {
  workspaceId: string | undefined;
  projectId: string;
  rules: AutomationRule[] | undefined;
  isLoading: boolean;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const actions = useRuleActions(workspaceId, projectId);

  const addRule = () =>
    void navigate({
      to: '/projects/$projectId/automations/add',
      params: { projectId },
      search: {},
    });

  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">In this project</h3>
          <p className="text-xs text-muted-foreground">Triggered by activity in this project</p>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={addRule}>
            <Plus />
            Add
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-0.5">
        {isLoading &&
          Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}

        {!isLoading && (rules ?? []).length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No rules yet.
          </p>
        )}

        {(rules ?? []).map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onOpen={() => actions.edit(rule)}
            menu={
              canManage ? (
                <RuleActionsMenu
                  rule={rule}
                  actions={actions}
                  // Asana's ⋯ waits for the pointer; a screen without one shows it.
                  className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                />
              ) : undefined
            }
          />
        ))}
      </div>

      {actions.dialogs}
    </div>
  );
}

/** One rule: what sets it off, its name, and "Active · Last run yesterday". */
function RuleRow({
  rule,
  onOpen,
  menu,
}: {
  rule: AutomationRule;
  onOpen: () => void;
  menu: ReactNode;
}) {
  const failed =
    rule.lastRunStatus === AutomationExecutionStatus.FAILED ||
    rule.lastRunStatus === AutomationExecutionStatus.PARTIALLY_FAILED;

  return (
    <div className="group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-muted/50 focus-within:bg-muted/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <TriggerIcon triggerType={rule.triggerType} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{rule.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {STATE_LABEL[rule.status] ?? rule.status.toLowerCase()}
            {' · '}
            {rule.lastRunAt ? (
              // A failure is the one run worth seeing from here.
              <span className={cn(failed && 'text-destructive')}>
                {failed ? 'Last run failed' : 'Last run'} {formatRelativeTime(rule.lastRunAt)}
              </span>
            ) : (
              'Never run'
            )}
            {/* Changed in the bundle, not here: the next sync replaces it. */}
            {rule.bundleId && ' · From a bundle'}
          </span>
        </span>
      </button>
      {menu}
    </div>
  );
}
