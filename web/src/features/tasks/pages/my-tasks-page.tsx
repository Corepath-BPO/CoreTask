import { TASK_PRIORITIES, TASK_STATUSES, TaskStatus, WorkspaceRole } from '@coretask/contracts';
import type { Task } from '@coretask/types';
import { CircleCheckBig, Search } from 'lucide-react';
import { useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/data-display/stat-card';
import { TaskPriorityBadge, TaskStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, daysUntil, formatDate, formatDueDate, humanizeEnum, initials } from '@/lib/utils';

import { TaskDetailDialog } from '../components/task-detail-dialog';
import { useTasks } from '../hooks/use-tasks';

const ALL = '__all__';
const OPEN_ONLY = '__open__';
/** Accepts any RFC 4122 version, including the v7 ids this schema generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 25;

export function MyTasksPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [statusFilter, setStatusFilter] = useState<string>(OPEN_ONLY);
  const [priority, setPriority] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  /*
   * Notifications link here as `/my-tasks?task=<id>`. Without this the link
   * lands on a list and leaves the reader to find the task it was about, which
   * is most of the notification's value gone.
   *
   * Seeded into state rather than synchronised with the URL: arriving on a deep
   * link is an entry condition, not an ongoing relationship. An effect that kept
   * them in step would reopen the dialog every time the user closed it.
   */
  const routeSearch: Partial<{ task: string }> = useSearch({ strict: false });
  const linkedTask = routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;

  const [openTaskId, setOpenTaskId] = useState<string | null>(linkedTask);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  /** Filters reset paging where they change, not in an effect reacting to them. */
  const applyFilter =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const params = useMemo(() => {
    const status =
      statusFilter === OPEN_ONLY
        ? TASK_STATUSES.filter(
            (value) => value !== TaskStatus.DONE && value !== TaskStatus.CANCELLED,
          )
        : statusFilter === ALL
          ? undefined
          : [statusFilter];

    return {
      page,
      limit: PAGE_SIZE,
      ...(scope === 'me' ? { assigneeId: 'me' } : {}),
      ...(status ? { status: [...status] } : {}),
      ...(priority !== ALL ? { priority: [priority] } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    };
  }, [page, scope, statusFilter, priority, debouncedSearch]);

  const { data, isLoading, isError, error } = useTasks(workspaceId, params);

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const tasks = data?.items ?? [];
  const meta = data?.meta;
  const summary = meta?.summary;

  if (workspaceLoading) return <MyTasksSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={CircleCheckBig}
        title="No workspace yet"
        description="Create a workspace before tracking tasks."
        className="mt-10"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Tasks"
        description={
          scope === 'me'
            ? `Work assigned to you across ${workspace.name}.`
            : `All work across ${workspace.name}.`
        }
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Matching tasks" value={summary.total} />
          <StatCard label="Completed" value={summary.completed} />
          <StatCard label="Overdue" value={summary.overdue} invertDelta />
          <StatCard label="Unassigned" value={summary.unassigned} invertDelta />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => applyFilter(setSearch)(event.target.value)}
            placeholder="Search task titles…"
            aria-label="Search tasks"
            className="pl-9"
          />
        </div>

        <Select
          value={scope}
          onValueChange={(value) => applyFilter(setScope)(value as 'me' | 'all')}
        >
          <SelectTrigger aria-label="Filter by assignee" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="all">Everyone</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={applyFilter(setStatusFilter)}>
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPEN_ONLY}>Open only</SelectItem>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TASK_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={applyFilter(setPriority)}>
          <SelectTrigger aria-label="Filter by priority" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any priority</SelectItem>
            {TASK_PRIORITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load tasks.'}
          </CardContent>
        </Card>
      )}

      {isLoading && <TaskRowsSkeleton />}

      {!isLoading && !isError && tasks.length === 0 && (
        <EmptyState
          icon={CircleCheckBig}
          title={scope === 'me' ? 'Nothing assigned to you' : 'No tasks match those filters'}
          description={
            scope === 'me'
              ? 'Tasks assigned to you will appear here. Open a project board to pick something up.'
              : 'Try a different search term, or widen the filters.'
          }
        />
      )}

      {tasks.length > 0 && (
        <Card>
          <CardContent className="px-0 py-0">
            <ul className="divide-y">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} onOpen={setOpenTaskId} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} of {meta.totalPages} · {meta.total} tasks
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <TaskDetailDialog
        workspaceId={workspaceId}
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        role={role}
      />
    </div>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: (taskId: string) => void }) {
  const done = task.status === TaskStatus.DONE;
  const overdue = task.dueDate !== null && !done && daysUntil(task.dueDate) < 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-sm font-medium',
              done && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </p>
          {task.subtaskCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {task.completedSubtaskCount}/{task.subtaskCount} subtasks
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <TaskPriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} />
          {task.dueDate && (
            <span
              className={cn(
                'w-20 text-right text-xs tabular-nums',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {/* Completed work is not overdue; show the date, not a countdown. */}
              {done ? formatDate(task.dueDate) : formatDueDate(task.dueDate)}
            </span>
          )}
          {task.assignee ? (
            <Avatar className="size-6" title={task.assignee.name}>
              {task.assignee.avatarUrl && <AvatarImage src={task.assignee.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">
                {initials(task.assignee.name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Badge variant="muted" className="text-[10px]">
              Unassigned
            </Badge>
          )}
        </div>
      </button>
    </li>
  );
}

function MyTasksSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading tasks</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <TaskRowsSkeleton />
    </div>
  );
}

function TaskRowsSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
