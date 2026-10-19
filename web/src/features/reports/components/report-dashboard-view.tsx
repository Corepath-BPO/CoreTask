import { MAX_REPORT_CHARTS, REPORT_COMPLETION_LABEL, ReportChartKind } from '@coretask/contracts';
import type { ReportChart, ReportDashboard } from '@coretask/types';
import { BarChart3, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useReportResult, useUpdateReportDashboard } from '../hooks/use-report-dashboards';

import { ChartEditorDialog } from './chart-editor-dialog';
import { ReportChartView } from './report-chart-view';

/**
 * One dashboard: its charts in a grid, each worked out for the reader. Its
 * owner, or a manager, adds, changes and removes charts; everyone else reads.
 */
export function ReportDashboardView({
  workspaceId,
  dashboard,
  canEdit,
}: {
  workspaceId: string | undefined;
  dashboard: ReportDashboard;
  canEdit: boolean;
}) {
  const update = useUpdateReportDashboard(workspaceId);
  const [editing, setEditing] = useState<ReportChart | 'new' | null>(null);

  const saveCharts = (charts: ReportChart[]) =>
    update.mutate({ dashboardId: dashboard.id, draft: { charts } });

  const save = (chart: ReportChart) => {
    saveCharts(
      dashboard.charts.some((entry) => entry.id === chart.id)
        ? dashboard.charts.map((entry) => (entry.id === chart.id ? chart : entry))
        : [...dashboard.charts, chart],
    );
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      {canEdit && dashboard.charts.length < MAX_REPORT_CHARTS && (
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          <Plus />
          Add chart
        </Button>
      )}

      {dashboard.charts.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No charts yet"
          description={
            canEdit
              ? 'Add a chart to count tasks by status, assignee, project or week.'
              : 'Its owner has not added any charts.'
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.charts.map((chart) => (
            <ChartCard
              key={chart.id}
              workspaceId={workspaceId}
              chart={chart}
              canEdit={canEdit}
              onEdit={() => setEditing(chart)}
              onRemove={() => saveCharts(dashboard.charts.filter((entry) => entry.id !== chart.id))}
            />
          ))}
        </div>
      )}

      <ChartEditorDialog
        workspaceId={workspaceId}
        chart={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={save}
      />
    </div>
  );
}

function ChartCard({
  workspaceId,
  chart,
  canEdit,
  onEdit,
  onRemove,
}: {
  workspaceId: string | undefined;
  chart: ReportChart;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { data, isLoading } = useReportResult(workspaceId, {
    groupBy: chart.groupBy,
    completion: chart.completion,
    projectIds: chart.projectIds,
    overdueOnly: chart.overdueOnly,
  });

  const filters = [
    REPORT_COMPLETION_LABEL[chart.completion],
    chart.overdueOnly && 'overdue only',
    chart.projectIds.length > 0 &&
      `${chart.projectIds.length} project${chart.projectIds.length === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <Card className={cn('min-h-56', chart.kind === ReportChartKind.NUMBER && 'min-h-40')}>
      <CardHeader>
        <CardTitle className="truncate">{chart.title}</CardTitle>
        <CardDescription className="truncate">{filters.join(' · ')}</CardDescription>
        {canEdit && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for ${chart.title}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil />
                  Edit chart
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2 />
                  Remove chart
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading || !data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ReportChartView title={chart.title} kind={chart.kind} result={data} />
        )}
      </CardContent>
    </Card>
  );
}
