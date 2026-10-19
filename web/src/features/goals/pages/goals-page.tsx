import { GoalStatus, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { ChevronDown, ChevronRight, Plus, Target } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { PersonAvatar } from '@/components/data-display/person-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { CreateGoalDialog } from '../components/create-goal-dialog';
import { GoalDetailSheet } from '../components/goal-detail-sheet';
import { GoalProgress, GoalStatusBadge } from '../components/goal-status';
import { useGoals } from '../hooks/use-goals';
import { flattenGoalTree } from '../lib/goal-tree';

type Scope = 'all' | 'mine';

/**
 * Asana's Goals: the outcomes the work is for, as a tree — company goals
 * over the goals that support them — each with a status, an owner, a time
 * period and progress that can roll up from sub-goals or connected projects.
 */
export function GoalsPage({ goalId = null }: { goalId?: string | null } = {}) {
  const navigate = useNavigate();
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canCreate = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const me = useCurrentUser();

  const { data: goals, isLoading } = useGoals(workspaceId);
  const [scope, setScope] = useState<Scope>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The open goal lives in the address bar, so a notification can open it.
  const openGoalId = goalId;
  const setOpenGoalId = (id: string | null) =>
    void navigate({ to: '/goals', search: id ? { goal: id } : {}, replace: openGoalId !== null });
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);

  const all = useMemo(() => goals ?? [], [goals]);
  const shown = useMemo(
    () => (scope === 'mine' ? all.filter((goal) => goal.owner?.id === me?.id) : all),
    [all, scope, me?.id],
  );
  const rows = useMemo(() => flattenGoalTree(shown, collapsed), [shown, collapsed]);
  const openGoal = all.find((goal) => goal.id === openGoalId) ?? null;

  const tally = useMemo(() => {
    const count = (status: GoalStatus) => shown.filter((goal) => goal.status === status).length;
    return [
      { label: 'On track', value: count(GoalStatus.ON_TRACK) },
      { label: 'At risk', value: count(GoalStatus.AT_RISK) },
      { label: 'Off track', value: count(GoalStatus.OFF_TRACK) },
      { label: 'Achieved', value: count(GoalStatus.ACHIEVED) },
    ];
  }, [shown]);

  const toggle = (goalId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Goals"
        description="The outcomes this workspace is working towards, and how far along each one is."
        actions={
          canCreate ? (
            <Button onClick={() => setCreating({ parentId: null })}>
              <Plus />
              Create goal
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Show">
          {(
            [
              ['all', 'All goals'],
              ['mine', 'My goals'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                scope === value
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <dl className="ml-auto flex flex-wrap gap-4 text-sm" aria-label="Goals by status">
          {tally.map((entry) => (
            <div key={entry.label} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{entry.label}</dt>
              <dd className="font-semibold tabular-nums">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={scope === 'mine' ? 'You own no goals' : 'No goals yet'}
          description={
            scope === 'mine'
              ? 'Goals you own appear here.'
              : 'Set the outcomes your work is for, then connect the projects that move them.'
          }
          action={
            canCreate && scope === 'all' ? (
              <Button onClick={() => setCreating({ parentId: null })}>
                <Plus />
                Create the first goal
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="px-0 py-0">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_10rem_6.5rem_2rem] items-center gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground max-md:hidden">
              <span>Name</span>
              <span>Status</span>
              <span>Progress</span>
              <span>Time period</span>
              <span className="sr-only">Owner</span>
            </div>
            <ul className="divide-y divide-border/70">
              {rows.map(({ goal, depth, childCount }) => (
                <li
                  key={goal.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_7rem_10rem_6.5rem_2rem]"
                >
                  <div
                    className="flex min-w-0 items-center gap-1.5"
                    style={{ paddingLeft: depth * 20 }}
                  >
                    {childCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggle(goal.id)}
                        aria-expanded={!collapsed.has(goal.id)}
                        aria-label={`${collapsed.has(goal.id) ? 'Expand' : 'Collapse'} ${goal.name}`}
                        className="shrink-0 cursor-pointer rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      >
                        {collapsed.has(goal.id) ? (
                          <ChevronRight className="size-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenGoalId(goal.id)}
                      className="min-w-0 cursor-pointer truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:underline"
                    >
                      {goal.name}
                    </button>
                    {childCount > 0 && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                        {childCount}
                      </span>
                    )}
                  </div>
                  <div className="max-md:hidden">
                    <GoalStatusBadge status={goal.status} />
                  </div>
                  <GoalProgress value={goal.progress} className="max-md:w-28" />
                  <span className="truncate text-sm text-muted-foreground max-md:hidden">
                    {goal.timePeriod ?? '—'}
                  </span>
                  <span className="max-md:hidden">
                    {goal.owner && (
                      <PersonAvatar
                        name={goal.owner.name}
                        avatarUrl={goal.owner.avatarUrl}
                        className="size-6"
                        fallbackClassName="text-[10px]"
                        title={goal.owner.name}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {creating && (
        <CreateGoalDialog
          open
          onOpenChange={(open) => !open && setCreating(null)}
          workspaceId={workspaceId}
          goals={all}
          parentId={creating.parentId}
          onCreated={(goal) => setOpenGoalId(goal.id)}
        />
      )}

      <GoalDetailSheet
        workspaceId={workspaceId}
        goal={openGoal}
        goals={all}
        role={role}
        onClose={() => setOpenGoalId(null)}
        onOpenGoal={setOpenGoalId}
        onAddSubGoal={(parentId) => setCreating({ parentId })}
      />
    </div>
  );
}
