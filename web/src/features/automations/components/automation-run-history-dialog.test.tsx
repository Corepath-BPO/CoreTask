import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, userEvent } from '@/test/test-utils';

import type { AutomationRule } from '../api/automations.api';

import { AutomationRunHistoryDialog } from './automation-run-history-dialog';

const executions = vi.fn();

vi.mock('../api/automations.api', () => ({
  automationsApi: { executions: (...args: unknown[]) => executions(...args) },
}));

const run = (id: string, minutesAgo: number) => ({
  id,
  status: 'COMPLETED',
  triggerType: 'TASK_CREATED',
  startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  durationMs: 12,
  error: null,
  skippedReason: null,
  logs: [],
});

const rule = { id: 'rule-1', name: 'Assign on arrival' } as AutomationRule;

describe('AutomationRunHistoryDialog', () => {
  it('shows the newest page, then older runs on request, without repeating one', async () => {
    executions.mockImplementation(
      async (_workspaceId: string, _projectId: string, _ruleId: string, page: number) =>
        page === 1
          ? {
              items: [run('a', 1), run('b', 2)],
              meta: { page: 1, limit: 2, total: 3, totalPages: 2 },
            }
          : {
              // A run landed meanwhile, so page 2 starts with one already shown.
              items: [run('b', 2), run('c', 3)],
              meta: { page: 2, limit: 2, total: 4, totalPages: 2 },
            },
    );

    renderWithProviders(
      <AutomationRunHistoryDialog
        workspaceId="ws-1"
        projectId="p-1"
        rule={rule}
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText(/the newest 2 of 3 runs/)).toBeInTheDocument();
    expect(screen.getAllByText('completed')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Show older runs' }));

    expect(await screen.findAllByText('completed')).toHaveLength(3);
    expect(executions).toHaveBeenLastCalledWith('ws-1', 'p-1', 'rule-1', 2);
    expect(screen.queryByRole('button', { name: 'Show older runs' })).not.toBeInTheDocument();
  });
});
