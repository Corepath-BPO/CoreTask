import { ReportChartKind, type ColorToken } from '@coretask/contracts';
import type { ReportResult } from '@coretask/types';

import { resolveColor } from '@/features/colors/lib/color-tokens';
import { cn } from '@/lib/utils';
import { useTheme } from '@/stores/theme.store';

type Group = ReportResult['groups'][number];

/**
 * The categorical order for groups that carry no colour of their own —
 * assignees, mostly. Fixed and never cycled: past it, the rest fold into
 * "Other" rather than reuse a hue that already means someone else.
 */
const CATEGORICAL: readonly ColorToken[] = [
  'blue',
  'violet',
  'teal',
  'amber',
  'pink',
  'green',
  'orange',
];
const MAX_SLICES = CATEGORICAL.length;

const pct = (value: number, total: number) => (total === 0 ? 0 : Math.round((value / total) * 100));

/** A group's colour: its own token or hex, else its place in the categorical order. */
function useGroupColor() {
  const { resolvedTheme } = useTheme();
  return (group: Group, index: number) => {
    // "Other" and the nobody bucket are no one's colour: neutral grey.
    if (group.key === 'other' || group.key === 'none') {
      return resolveColor({ colorToken: 'gray' }, resolvedTheme).solid;
    }
    if (group.color?.startsWith('#')) return group.color;
    if (group.color) return resolveColor({ colorToken: group.color }, resolvedTheme).solid;
    return resolveColor(
      { colorToken: CATEGORICAL[index % CATEGORICAL.length] ?? 'blue' },
      resolvedTheme,
    ).solid;
  };
}

/** The largest groups, with the rest folded into one "Other". */
function folded(groups: readonly Group[]): Group[] {
  const shown = groups.filter((group) => group.count > 0);
  if (shown.length <= MAX_SLICES) return shown;
  const head = shown.slice(0, MAX_SLICES - 1);
  const rest = shown.slice(MAX_SLICES - 1).reduce((sum, group) => sum + group.count, 0);
  return [...head, { key: 'other', label: 'Other', count: rest, color: null }];
}

/** Every chart's numbers as a table, for whoever cannot see the picture. */
function DataTable({ title, groups }: { title: string; groups: readonly Group[] }) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <tbody>
        {groups.map((group) => (
          <tr key={group.key}>
            <th scope="row">{group.label}</th>
            <td>{group.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One chart, drawn from its answer. */
export function ReportChartView({
  title,
  kind,
  result,
}: {
  title: string;
  kind: ReportChartKind;
  result: ReportResult;
}) {
  const color = useGroupColor();

  if (kind === ReportChartKind.NUMBER) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-1 py-2">
        <span className="text-5xl font-semibold tabular-nums tracking-[-0.04em]">
          {result.total}
        </span>
        <span className="text-sm text-muted-foreground">
          {result.total === 1 ? 'task' : 'tasks'}
        </span>
      </div>
    );
  }

  if (result.total === 0 || result.groups.every((group) => group.count === 0)) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No tasks match.</p>;
  }

  if (kind === ReportChartKind.COLUMN) {
    const max = Math.max(1, ...result.groups.map((group) => group.count));
    return (
      <figure>
        <div className="flex h-40 items-end gap-1.5" aria-hidden="true">
          {result.groups.map((group) => (
            <div
              key={group.key}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              title={`${group.label}: ${group.count}`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                {group.count}
              </span>
              <span
                className="w-full max-w-6 rounded-t bg-primary transition-[height]"
                style={{ height: `${(group.count / max) * 100}%`, minHeight: group.count ? 2 : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5 border-t pt-1" aria-hidden="true">
          {result.groups.map((group, index) => (
            <span
              key={group.key}
              className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground"
            >
              {/* Every other label, so twelve weeks stay readable at card width. */}
              {index % 2 === 0 ? group.label : ''}
            </span>
          ))}
        </div>
        <DataTable title={title} groups={result.groups} />
      </figure>
    );
  }

  const groups = folded(result.groups);

  if (kind === ReportChartKind.DONUT) {
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    // Where each slice starts along the ring — worked out before drawing.
    const starts = groups.reduce<number[]>(
      (acc, _group, index) => [
        ...acc,
        index === 0
          ? 0
          : (acc[index - 1] ?? 0) + ((groups[index - 1]?.count ?? 0) / total) * circumference,
      ],
      [],
    );
    return (
      <figure className="flex flex-wrap items-center gap-5">
        <svg viewBox="0 0 100 100" className="size-32 shrink-0 -rotate-90" aria-hidden="true">
          {groups.map((group, index) => {
            const length = (group.count / total) * circumference;
            const segment = (
              <circle
                key={group.key}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={color(group, index)}
                strokeWidth="12"
                // A hair of surface between slices, so neighbours stay apart.
                strokeDasharray={`${Math.max(0, length - 1)} ${circumference}`}
                strokeDashoffset={-(starts[index] ?? 0)}
              >
                <title>{`${group.label}: ${group.count} (${pct(group.count, total)}%)`}</title>
              </circle>
            );
            return segment;
          })}
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {groups.map((group, index) => (
            <li key={group.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: color(group, index) }}
              />
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {group.count} · {pct(group.count, total)}%
              </span>
            </li>
          ))}
        </ul>
        <DataTable title={title} groups={groups} />
      </figure>
    );
  }

  // BAR: one row per group, longest first as the server ordered them.
  const max = Math.max(1, ...groups.map((group) => group.count));
  return (
    <figure className="space-y-2.5">
      {groups.map((group, index) => (
        <div
          key={group.key}
          className="grid grid-cols-[minmax(0,8rem)_1fr_2.5rem] items-center gap-3"
          title={`${group.label}: ${group.count} (${pct(group.count, result.total)}%)`}
        >
          <span className={cn('truncate text-xs', group.key === 'none' && 'text-muted-foreground')}>
            {group.label}
          </span>
          <span className="h-2 rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(group.count / max) * 100}%`,
                backgroundColor: color(group, index),
              }}
            />
          </span>
          <span className="text-right text-xs font-semibold tabular-nums">{group.count}</span>
        </div>
      ))}
      <DataTable title={title} groups={groups} />
    </figure>
  );
}
