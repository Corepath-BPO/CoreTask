import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjectWorkItems } from '@/features/work-items/hooks/use-project-work-items';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate } from '@/lib/utils';
import { fromYmd, ymd } from '@/lib/utils/dates';

import { useProject } from '../hooks/use-projects';
import { computeDashboard, type BarDatum, type BurnupPoint } from '../lib/dashboard-stats';

const NUMBER = new Intl.NumberFormat('en');

/**
 * The project's Dashboard tab — Asana's default project charts, computed from
 * the same work items the List and Board read, so the numbers can never
 * disagree with what those tabs show.
 *
 * One accent hue throughout: every chart here plots a single measure, so the
 * colour carries no identity and none is needed. The burn-up is the one place
 * with two lines, and there the completed line is the story and the total is
 * grey context.
 */
export function ProjectDashboardPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project, isLoading: projectLoading } = useProject(workspaceId, projectId);
  const { data, isLoading } = useProjectWorkItems(workspaceId, projectId, {});

  const stats = useMemo(
    () => computeDashboard(data?.items ?? [], project?.sections ?? [], ymd(new Date())),
    [data, project?.sections],
  );

  if (projectLoading || isLoading || !project) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
        <Skeleton className="h-64 md:col-span-2" />
        <Skeleton className="h-64 md:col-span-2" />
      </div>
    );
  }

  const completion = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="Totals">
        <StatTile label="Completed tasks" value={stats.completed} />
        <StatTile label="Incomplete tasks" value={stats.incomplete} />
        <StatTile
          label="Overdue tasks"
          value={stats.overdue}
          alert={stats.overdue > 0 ? 'Past their due date' : undefined}
        />
        <StatTile label="Total tasks" value={stats.total} />
      </div>

      <Card>
        <CardContent className="space-y-2 pt-5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Project completion</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{completion}%</span> ·{' '}
              {NUMBER.format(stats.completed)} of {NUMBER.format(stats.total)} done
            </p>
          </div>
          {/* A meter, not a two-slice pie: one ratio against a whole. */}
          <div
            role="meter"
            aria-label="Project completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion}
            className="h-2.5 overflow-hidden rounded-full bg-primary/15"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Incomplete tasks by section"
          description="What is still open, in the project's section order."
        >
          <BarList data={stats.bySection} unit="incomplete" emptyText="No sections yet." />
        </ChartCard>

        <ChartCard
          title="Incomplete tasks by assignee"
          description="Who is carrying the open work."
        >
          <BarList data={stats.byAssignee} unit="incomplete" emptyText="Nothing open." />
        </ChartCard>
      </div>

      <ChartCard
        title="Task completion over time"
        description="Tasks that existed, and tasks completed, by the end of each of the last eight weeks."
      >
        <Burnup points={stats.burnup} />
      </ChartCard>
    </div>
  );
}

function StatTile({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: string | undefined;
}) {
  return (
    <Card role="listitem">
      <CardContent className="space-y-1 pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold">{NUMBER.format(value)}</p>
        {alert && (
          // Status, so an icon and words with it — never the colour alone.
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {alert}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Horizontal bars for one measure: label left, bar from a shared baseline,
 * value at the tip. Rows are the hover targets — the whole line, not the bar
 * alone, so a short bar is as easy to point at as a long one.
 */
function BarList({ data, unit, emptyText }: { data: BarDatum[]; unit: string; emptyText: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((datum) => datum.value));

  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <ul className="space-y-1.5" aria-hidden="true">
        {data.map((datum) => {
          const width = (datum.value / max) * 100;
          const active = hover === datum.id;
          return (
            <li
              key={datum.id || datum.label}
              onPointerEnter={() => setHover(datum.id)}
              onPointerLeave={() => setHover(null)}
              title={`${datum.label}: ${NUMBER.format(datum.value)} ${unit}`}
              className={cn(
                'grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 rounded-md px-1.5 py-1 transition-colors',
                active && 'bg-muted/60',
              )}
            >
              <span className="truncate text-sm text-muted-foreground">{datum.label}</span>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    // 4px rounded data-end, square at the baseline; thin, never the full slot.
                    'h-3.5 rounded-r-[4px] bg-primary transition-opacity',
                    hover && !active && 'opacity-50',
                  )}
                  style={{ width: datum.value === 0 ? 0 : `max(${width}%, 4px)` }}
                />
                <span className="text-xs font-medium tabular-nums">
                  {NUMBER.format(datum.value)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Tasks {unit}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.id || datum.label}>
              <th scope="row">{datum.label}</th>
              <td>{datum.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const CHART_HEIGHT = 200;
const PAD = { top: 12, right: 72, bottom: 24, left: 36 };

/**
 * The burn-up: total in grey context, completed in the accent with a light
 * wash beneath it. A crosshair and a tooltip follow the pointer week by week;
 * the two lines are labelled at their ends, with a legend for the case the
 * labels cannot make on their own.
 */
function Burnup({ points }: { points: BurnupPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;

  const max = Math.max(1, ...points.map((point) => point.total));
  // Clean ticks: the top is the next tidy step at or above the maximum, with
  // a middle line only when it lands on a whole number of tasks.
  const step = niceStep(max / 2);
  const top = Math.ceil(max / step) * step;
  const ticks = Number.isInteger(top / 2) ? [0, top / 2, top] : [0, top];

  const x = (index: number) =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;

  const line = (key: 'total' | 'completed') =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point[key])}`)
      .join(' ');
  const area = `${line('completed')} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  const last = points[points.length - 1];
  const hovered = hover === null ? null : points[hover];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-muted-foreground/60" />
          Total
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={
            last
              ? `Completed tasks rose to ${last.completed} of ${last.total} over the last ${points.length} weeks.`
              : 'No data'
          }
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const px = ((event.clientX - bounds.left) / bounds.width) * width;
            const index = Math.round(((px - PAD.left) / plotWidth) * (points.length - 1));
            setHover(Math.min(points.length - 1, Math.max(0, index)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {NUMBER.format(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) =>
            index % 2 === points.length % 2 ? null : (
              <text
                key={point.week}
                x={x(index)}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {formatDate(fromYmd(point.week))}
              </text>
            ),
          )}

          <path d={area} className="fill-primary" opacity={0.1} />
          <path
            d={line('total')}
            fill="none"
            className="stroke-muted-foreground/60"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={line('completed')}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {last && (
            <>
              <circle
                cx={x(points.length - 1)}
                cy={y(last.completed)}
                r={4}
                className="fill-primary stroke-card"
                strokeWidth={2}
              />
              <text
                x={x(points.length - 1) + 10}
                y={y(last.completed)}
                dominantBaseline="middle"
                className="fill-foreground text-[11px] font-medium"
              >
                {last.completed} done
              </text>
              {last.total !== last.completed && (
                <text
                  x={x(points.length - 1) + 10}
                  y={y(last.total) - (Math.abs(y(last.total) - y(last.completed)) < 14 ? 10 : 0)}
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {last.total} total
                </text>
              )}
            </>
          )}

          {hovered && hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                className="stroke-muted-foreground/40"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(hovered.total)}
                r={4}
                className="fill-muted-foreground stroke-card"
                strokeWidth={2}
              />
              <circle
                cx={x(hover)}
                cy={y(hovered.completed)}
                r={4}
                className="fill-primary stroke-card"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {hovered && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `${(x(hover) / width) * 100}%`,
              transform:
                hover > points.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}
          >
            <p className="font-medium">Week of {formatDate(fromYmd(hovered.week))}</p>
            <p className="text-muted-foreground">
              {hovered.completed} completed · {hovered.total} total
            </p>
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Tasks by the end of each week</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Completed</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.week}>
              <th scope="row">{formatDate(fromYmd(point.week))}</th>
              <td>{point.completed}</td>
              <td>{point.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A tidy step (1, 2, 5 × 10ⁿ) at or above `raw`. */
function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}
