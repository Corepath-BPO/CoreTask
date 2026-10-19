import type { ReportResult } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChartEditorDialog } from './chart-editor-dialog';
import { ReportChartView } from './report-chart-view';

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({
    data: { items: [{ id: 'p-1', name: 'Leasing', color: '#6366f1' }] },
  }),
}));

const result = (groups: [string, number][], total?: number): ReportResult => ({
  total: total ?? groups.reduce((sum, [, count]) => sum + count, 0),
  groups: groups.map(([label, count]) => ({ key: label, label, count, color: null })),
});

describe('ReportChartView', () => {
  it('draws a number as the total', () => {
    render(<ReportChartView title="Open" kind="NUMBER" result={{ total: 7, groups: [] }} />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('tasks')).toBeInTheDocument();
  });

  it('labels each bar with its count, and keeps a table of the numbers', () => {
    render(
      <ReportChartView
        title="By assignee"
        kind="BAR"
        result={result([
          ['Ada', 5],
          ['Bea', 2],
        ])}
      />,
    );
    const table = screen.getByRole('table', { name: 'By assignee' });
    expect(within(table).getByRole('row', { name: 'Ada 5' })).toBeInTheDocument();
    expect(screen.getByTitle('Ada: 5 (71%)')).toBeInTheDocument();
  });

  it('folds the tail of a donut into Other, and says when nothing matches', () => {
    const many = result(Array.from({ length: 10 }, (_, index) => [`P${index}`, 10 - index]));
    const { unmount } = render(<ReportChartView title="Projects" kind="DONUT" result={many} />);
    const table = screen.getByRole('table', { name: 'Projects' });
    // Six named slices and one Other: the categorical order is never cycled.
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(table).getByRole('row', { name: 'Other 10' })).toBeInTheDocument();
    unmount();

    render(<ReportChartView title="Empty" kind="BAR" result={result([], 0)} />);
    expect(screen.getByText('No tasks match.')).toBeInTheDocument();
  });
});

describe('ChartEditorDialog', () => {
  it('keeps the chart kind fitting the grouping, and names an untitled chart', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChartEditorDialog
          workspaceId="ws-1"
          chart={null}
          open
          onOpenChange={vi.fn()}
          onSave={onSave}
        />
      </QueryClientProvider>,
    );

    // Total only can only be a number; the saved chart says so below.
    await user.click(screen.getByRole('combobox', { name: 'Group by' }));
    await user.click(await screen.findByRole('option', { name: 'Total only' }));

    await user.click(screen.getByRole('checkbox', { name: /Leasing/ }));
    await user.click(screen.getByRole('button', { name: 'Save chart' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Incomplete tasks',
        kind: 'NUMBER',
        groupBy: 'NONE',
        projectIds: ['p-1'],
      }),
    );
  });
});
