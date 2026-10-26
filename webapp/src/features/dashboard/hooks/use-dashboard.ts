import { TaskStatus } from '@coretask/contracts';
import type { Task } from '@coretask/types';
import { useMemo } from 'react';

import { useActivityFeed } from '@/features/activity/hooks/use-activity';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useTasks } from '@/features/tasks/hooks/use-tasks';
import { useTickets } from '@/features/tickets/hooks/use-tickets';
import { daysUntil } from '@/lib/utils';

const OPEN_STATUSES = [
  TaskStatus.BACKLOG,
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.BLOCKED,
];

export interface DashboardSummaryTile {
  label: string;
  value: number;
  hint: string;
  /** True where a rising number is bad. */
  invert?: boolean;
}

/**
 * Live dashboard data.
 *
 * Three narrow queries rather than one bespoke endpoint: the tasks list already
 * returns a rollup over the whole filter, so the counts come from `meta.summary`
 * without loading every row.
 */
export function useDashboardData(workspaceId: string | undefined) {
  const assigned = useTasks(workspaceId, {
    assigneeId: 'me',
    status: [...OPEN_STATUSES],
    limit: 6,
  });

  const everything = useTasks(workspaceId, { limit: 1 });

  const upcoming = useTasks(workspaceId, {
    status: [...OPEN_STATUSES],
    dueBefore: twoWeeksOut(),
    limit: 5,
  });

  const projects = useProjects(workspaceId, { limit: 6 });

  // The queue is already ordered newest-first, so the first page is the recent
  // list and `meta.summary` supplies the tiles without a second request.
  const tickets = useTickets(workspaceId, { limit: 5 });
  const activity = useActivityFeed(workspaceId, 6);

  const taskTiles = useMemo<DashboardSummaryTile[]>(() => {
    const mine = assigned.data?.meta.summary;
    const all = everything.data?.meta.summary;

    return [
      {
        label: 'Assigned to you',
        value: mine?.total ?? 0,
        hint: `${upcoming.data?.meta.summary.total ?? 0} due in the next two weeks`,
      },
      {
        label: 'Open in workspace',
        value: (all?.total ?? 0) - (all?.completed ?? 0),
        hint: `${all?.total ?? 0} tasks in total`,
      },
      {
        label: 'Completed',
        value: all?.completed ?? 0,
        hint: 'Across every project',
      },
      {
        label: 'Overdue',
        value: all?.overdue ?? 0,
        hint: all?.overdue ? 'Needs attention' : 'Nothing past due',
        invert: true,
      },
    ];
  }, [assigned.data, everything.data, upcoming.data]);

  const ticketTiles = useMemo<DashboardSummaryTile[]>(() => {
    const summary = tickets.data?.meta.summary;

    return [
      {
        label: 'Open tickets',
        value: summary?.open ?? 0,
        hint: `${summary?.unassigned ?? 0} unassigned`,
      },
      {
        label: 'Urgent',
        value: summary?.urgent ?? 0,
        hint: summary?.urgent ? 'Needs attention' : 'Nothing urgent',
        invert: true,
      },
      {
        label: 'Resolved',
        value: summary?.resolved ?? 0,
        hint: `${summary?.total ?? 0} reported in total`,
      },
      {
        label: 'Overdue',
        value: summary?.overdue ?? 0,
        hint: summary?.overdue ? 'Past the due date' : 'All on schedule',
        invert: true,
      },
    ];
  }, [tickets.data]);

  return {
    taskTiles,
    ticketTiles,
    assignedTasks: assigned.data?.items ?? [],
    upcomingTasks: sortByDueDate(upcoming.data?.items ?? []),
    projects: projects.data?.items ?? [],
    recentTickets: tickets.data?.items ?? [],
    recentActivity: activity.data ?? [],
    isLoading: assigned.isLoading || everything.isLoading || projects.isLoading,
  };
}

function sortByDueDate(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return daysUntil(a.dueDate) - daysUntil(b.dueDate);
  });
}

/**
 * End of the day, two weeks out.
 *
 * Rounded to a day boundary so the value is **stable between renders**. It is
 * part of a TanStack Query key, and a millisecond-precision `new Date()` made a
 * different key every render: new key → fetch → state update → re-render → new
 * key, a refetch loop that hammered the API until the rate limiter cut it off.
 *
 * End of day rather than start also matches the intent — "due in the next two
 * weeks" should include everything on the fourteenth day.
 */
function twoWeeksOut(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(23, 59, 59, 999);

  return date.toISOString();
}
