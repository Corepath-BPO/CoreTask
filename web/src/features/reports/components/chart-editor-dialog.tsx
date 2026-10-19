import {
  PAGINATION_MAX_LIMIT,
  REPORT_CHART_KINDS,
  REPORT_CHART_KIND_LABEL,
  REPORT_CHART_TITLE_MAX,
  REPORT_COMPLETIONS,
  REPORT_COMPLETION_LABEL,
  REPORT_GROUP_BYS,
  REPORT_GROUP_BY_LABEL,
  ReportChartKind,
  ReportCompletion,
  ReportGroupBy,
  chartKindFits,
} from '@coretask/contracts';
import type { ReportChart } from '@coretask/types';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjects } from '@/features/projects/hooks/use-projects';

/** A new chart's starting question: open work by assignee, as bars. */
const blank = (): ReportChart => ({
  id: crypto.randomUUID(),
  title: '',
  kind: ReportChartKind.BAR,
  groupBy: ReportGroupBy.ASSIGNEE,
  completion: ReportCompletion.OPEN,
  projectIds: [],
  overdueOnly: false,
});

/** The kind that suits a grouping when the current one cannot draw it. */
function kindFor(kind: ReportChartKind, groupBy: ReportGroupBy): ReportChartKind {
  if (chartKindFits(kind, groupBy)) return kind;
  if (groupBy === ReportGroupBy.NONE) return ReportChartKind.NUMBER;
  if (groupBy === ReportGroupBy.DUE_WEEK || groupBy === ReportGroupBy.COMPLETED_WEEK) {
    return ReportChartKind.COLUMN;
  }
  return ReportChartKind.BAR;
}

/**
 * Add or change one chart: what it counts, how it groups them, how it draws.
 *
 * A grouping and a kind that cannot go together are never both chosen — a
 * number has no groups, and every other kind needs some — so picking one
 * moves the other to the nearest kind that fits.
 */
export function ChartEditorDialog({
  workspaceId,
  chart,
  open,
  onOpenChange,
  onSave,
}: {
  workspaceId: string | undefined;
  /** The chart to change; null to add one. */
  chart: ReportChart | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (chart: ReportChart) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{chart ? 'Edit chart' : 'Add chart'}</DialogTitle>
          <DialogDescription>
            Counted over the tasks each viewer can see, every time the dashboard opens.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ChartForm
            workspaceId={workspaceId}
            initial={chart ?? blank()}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChartForm({
  workspaceId,
  initial,
  onCancel,
  onSave,
}: {
  workspaceId: string | undefined;
  initial: ReportChart;
  onCancel: () => void;
  onSave: (chart: ReportChart) => void;
}) {
  const [chart, setChart] = useState<ReportChart>(initial);
  const { data: projects } = useProjects(workspaceId, { limit: PAGINATION_MAX_LIMIT });
  const set = (patch: Partial<ReportChart>) => setChart((current) => ({ ...current, ...patch }));

  const title =
    chart.title.trim() ||
    (chart.groupBy === ReportGroupBy.NONE
      ? REPORT_COMPLETION_LABEL[chart.completion]
      : `${REPORT_COMPLETION_LABEL[chart.completion]} by ${REPORT_GROUP_BY_LABEL[chart.groupBy].toLowerCase()}`);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...chart, title });
      }}
    >
      <Field label="Title" htmlFor="chart-title">
        <Input
          id="chart-title"
          value={chart.title}
          maxLength={REPORT_CHART_TITLE_MAX}
          placeholder={title}
          onChange={(event) => set({ title: event.target.value })}
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Group by" htmlFor="chart-group">
          <Select
            value={chart.groupBy}
            onValueChange={(value) => {
              const groupBy = value as ReportGroupBy;
              set({ groupBy, kind: kindFor(chart.kind, groupBy) });
            }}
          >
            <SelectTrigger id="chart-group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_GROUP_BYS.map((option) => (
                <SelectItem key={option} value={option}>
                  {REPORT_GROUP_BY_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Chart" htmlFor="chart-kind">
          <Select
            value={chart.kind}
            onValueChange={(value) => {
              // Radix reports '' when its options change under it; only a kind
              // that can draw this grouping is an answer.
              const kind = value as ReportChartKind;
              if (REPORT_CHART_KINDS.includes(kind) && chartKindFits(kind, chart.groupBy)) {
                set({ kind });
              }
            }}
          >
            <SelectTrigger id="chart-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Every kind, the ones this grouping cannot draw greyed — the
                  list stays put while the grouping changes. */}
              {REPORT_CHART_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind} disabled={!chartKindFits(kind, chart.groupBy)}>
                  {REPORT_CHART_KIND_LABEL[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Tasks" htmlFor="chart-completion">
        <Select
          value={chart.completion}
          onValueChange={(value) => set({ completion: value as ReportCompletion })}
        >
          <SelectTrigger id="chart-completion" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_COMPLETIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {REPORT_COMPLETION_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={chart.overdueOnly}
          onCheckedChange={(checked) => set({ overdueOnly: checked === true })}
        />
        Only overdue tasks
      </label>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Projects</legend>
        <p className="text-xs text-muted-foreground">
          {chart.projectIds.length === 0
            ? 'Every project — tick some to narrow it.'
            : `${chart.projectIds.length} selected`}
        </p>
        <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
          {(projects?.items ?? []).map((project) => (
            <label key={project.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={chart.projectIds.includes(project.id)}
                onCheckedChange={(checked) =>
                  set({
                    projectIds:
                      checked === true
                        ? [...chart.projectIds, project.id]
                        : chart.projectIds.filter((id) => id !== project.id),
                  })
                }
              />
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate">{project.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save chart</Button>
      </DialogFooter>
    </form>
  );
}
