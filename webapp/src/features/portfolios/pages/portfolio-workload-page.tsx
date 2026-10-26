import {
  PORTFOLIO_CAPACITY_MAX,
  PortfolioWorkloadMeasure,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { PortfolioWorkload } from '@coretask/types';
import { Gauge } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { usePortfolioTasks } from '../hooks/use-portfolio-tasks';
import { usePortfolio, useSetPortfolioCapacity, useUpdatePortfolio } from '../hooks/use-portfolios';
import { capacityOf, loadOf, workloadByPerson } from '../lib/workload';

const hours = (minutes: number) =>
  minutes === 0 ? '—' : `${Math.round((minutes / 60) * 10) / 10}h`;

/** Before the portfolio arrives: count tasks, against nothing. */
const NO_WORKLOAD: PortfolioWorkload = {
  measure: PortfolioWorkloadMeasure.TASKS,
  defaultCapacity: null,
  capacities: [],
};

const UNIT: Record<PortfolioWorkloadMeasure, string> = {
  TASKS: 'open tasks',
  HOURS: 'hours',
};

/** A whole number from a text box within the capacity limits, or null while empty. */
function readCapacity(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value) || value < 0 || value > PORTFOLIO_CAPACITY_MAX) return undefined;
  return value;
}

/**
 * The portfolio's Workload tab — who carries the open work across its
 * projects, measured against how much each person should carry.
 *
 * Load is counted in the portfolio's measure, open tasks or the hours their
 * estimates add up to. Capacity is a default for everyone, with a different
 * number for whoever needs one; a person over theirs is drawn in red with by
 * how much. Without any capacity the bars compare people with each other, as
 * they did before there was one. Capacities are the owner's or a manager's to
 * set, like the rest of the portfolio.
 */
export function PortfolioWorkloadPage({ portfolioId }: { portfolioId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const me = useCurrentUser();
  const { portfolio, isLoading } = usePortfolio(workspaceId, portfolioId);
  const { tasks, isLoading: tasksLoading } = usePortfolioTasks(
    workspaceId,
    portfolio?.projectIds ?? [],
  );
  const update = useUpdatePortfolio(workspaceId);
  const setCapacity = useSetPortfolioCapacity(workspaceId);

  const canEdit =
    Boolean(portfolio && me && portfolio.owner?.id === me.id) ||
    hasAtLeastRole(workspace?.role ?? WorkspaceRole.GUEST, WorkspaceRole.MANAGER);

  const workload = portfolio?.workload ?? NO_WORKLOAD;
  const measure = workload.measure;

  const rows = useMemo(
    () =>
      workloadByPerson(tasks, new Date()).map((row) => {
        const capacity = capacityOf(row.person?.id ?? null, workload);
        return { row, load: loadOf(row, measure), capacity };
      }),
    [tasks, workload, measure],
  );
  const scale = Math.max(1, ...rows.flatMap((entry) => [entry.load, entry.capacity ?? 0]));
  const over = rows.filter((entry) => entry.capacity !== null && entry.load > entry.capacity);

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Workload</h2>
            <p className="text-sm text-muted-foreground">
              {over.length > 0
                ? `${over.length} ${over.length === 1 ? 'person is' : 'people are'} over capacity.`
                : 'Open work across this portfolio’s projects, by person.'}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div
              role="group"
              aria-label="Measure workload by"
              className="flex rounded-md border p-0.5"
            >
              {(Object.values(PortfolioWorkloadMeasure) as PortfolioWorkloadMeasure[]).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={measure === option}
                    disabled={!canEdit || !portfolio}
                    onClick={() =>
                      portfolio &&
                      update.mutate({ portfolioId, draft: { workloadMeasure: option } })
                    }
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default',
                      measure === option
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {option === PortfolioWorkloadMeasure.TASKS ? 'Task count' : 'Estimated hours'}
                  </button>
                ),
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Default capacity
              <CapacityInput
                key={`default-${workload.defaultCapacity}`}
                label="Default capacity"
                value={workload.defaultCapacity}
                disabled={!canEdit || !portfolio}
                placeholder="None"
                onCommit={(defaultCapacity) =>
                  update.mutate({ portfolioId, draft: { defaultCapacity } })
                }
              />
            </label>
          </div>
        </div>

        {isLoading || tasksLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No open work"
            description="Open tasks in this portfolio's projects are counted here, by person."
          />
        ) : (
          <Card>
            <CardContent className="py-4">
              <table className="w-full text-sm">
                <caption className="sr-only">Open work by person, against capacity</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Person</th>
                    <th className="pb-2 font-medium">
                      Load ({measure === PortfolioWorkloadMeasure.TASKS ? 'tasks' : 'hours'})
                    </th>
                    <th className="pb-2 font-medium">Capacity</th>
                    <th className="pb-2 text-right font-medium">Due this week</th>
                    <th className="pb-2 text-right font-medium">Overdue</th>
                    <th className="pb-2 text-right font-medium">
                      {measure === PortfolioWorkloadMeasure.TASKS ? 'Estimated' : 'Open tasks'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ row, load, capacity }) => {
                    const isOver = capacity !== null && load > capacity;
                    const personId = row.person?.id ?? null;
                    const own = personId
                      ? workload.capacities.find((entry) => entry.userId === personId)
                      : undefined;
                    return (
                      <tr key={personId ?? 'unassigned'} className="border-t">
                        <td className="py-2.5 pr-3">
                          <span className="flex items-center gap-2">
                            {row.person ? (
                              <PersonAvatar
                                name={row.person.name}
                                avatarUrl={row.person.avatarUrl}
                                className="size-6"
                                fallbackClassName="text-[9px]"
                              />
                            ) : null}
                            <span className={cn(!row.person && 'text-muted-foreground')}>
                              {row.person?.name ?? 'Unassigned'}
                            </span>
                          </span>
                        </td>
                        <td className="w-2/5 py-2.5 pr-3">
                          <span className="flex items-center gap-2">
                            <span
                              className="relative h-2 flex-1 rounded-full bg-muted"
                              role="img"
                              aria-label={
                                capacity === null
                                  ? `${load} ${UNIT[measure]}`
                                  : `${load} of ${capacity} ${UNIT[measure]}`
                              }
                            >
                              <span
                                className={cn(
                                  'block h-full rounded-full',
                                  isOver ? 'bg-destructive' : 'bg-primary',
                                )}
                                style={{ width: `${(load / scale) * 100}%` }}
                              />
                              {capacity !== null && (
                                <span
                                  aria-hidden="true"
                                  className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground/60"
                                  style={{ left: `calc(${(capacity / scale) * 100}% - 1px)` }}
                                />
                              )}
                            </span>
                            <span
                              className={cn(
                                'w-16 text-right tabular-nums',
                                isOver && 'font-medium text-destructive',
                              )}
                            >
                              {load}
                              {isOver && capacity !== null && (
                                <span className="text-xs">
                                  {' '}
                                  (+{Math.round((load - capacity) * 10) / 10})
                                </span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {personId ? (
                            <CapacityInput
                              key={`${personId}-${own?.capacity ?? 'default'}`}
                              label={`Capacity for ${row.person?.name ?? 'this person'}`}
                              value={own?.capacity ?? null}
                              disabled={!canEdit}
                              placeholder={
                                workload.defaultCapacity === null
                                  ? '—'
                                  : String(workload.defaultCapacity)
                              }
                              onCommit={(next) =>
                                setCapacity.mutate({
                                  portfolioId,
                                  userId: personId,
                                  capacity: next,
                                })
                              }
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{row.dueThisWeek}</td>
                        <td
                          className={cn(
                            'py-2.5 text-right tabular-nums',
                            row.overdue > 0 && 'font-medium text-destructive',
                          )}
                        >
                          {row.overdue}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {measure === PortfolioWorkloadMeasure.TASKS
                            ? hours(row.estimatedMinutes)
                            : row.open}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                The mark on each bar is that person’s capacity. A blank capacity uses the default.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * A capacity box that saves when it loses focus or on Enter, and only when
 * the number changed — typing "12" should not save "1" first.
 */
function CapacityInput({
  label,
  value,
  disabled,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  placeholder: string;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  const commit = () => {
    const next = readCapacity(draft);
    if (next === undefined) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={0}
      max={PORTFOLIO_CAPACITY_MAX}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="h-8 w-20 text-sm"
    />
  );
}
