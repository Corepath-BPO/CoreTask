import { SystemField, TaskStatus } from '@coretask/contracts';
import type { ProjectFieldMetadata, Task, ViewColumn } from '@coretask/types';
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { TaskPriorityBadge, TaskStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatDate, initials } from '@/lib/utils';

import { useFieldMetadata, useViewTasks } from '../hooks/use-project-views';

import { columnLabel } from '../lib/column-labels';

import { ColumnManager } from './column-manager';

interface ProjectListViewProps {
  workspaceId: string | undefined;
  projectId: string;
  columns: ViewColumn[];
  onColumnsChange: (columns: ViewColumn[]) => void;
  onOpenTask: (taskId: string) => void;
}

/**
 * The project's tasks as a table, grouped by section.
 *
 * Reads the same tasks through the same endpoint as the board — a view decides
 * which tasks and in what order, never what a task *is*. Filtering and sorting
 * happen in PostgreSQL, so a project with ten thousand tasks does not ship all
 * of them for the browser to hide most.
 */
export function ProjectListView({
  workspaceId,
  projectId,
  columns,
  onColumnsChange,
  onOpenTask,
}: ProjectListViewProps) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Debounced so typing does not fire a request per keystroke.
  useDebouncedValue(search, setDebounced);

  const { data, isLoading, isError } = useViewTasks(workspaceId, projectId, {
    search: debounced || undefined,
  });
  const { data: metadata } = useFieldMetadata(workspaceId, projectId);

  const tasks = useMemo(() => data?.items ?? [], [data]);

  const groups = useMemo(() => groupBySection(tasks, metadata), [tasks, metadata]);

  const toggle = (sectionId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="pl-9"
          />
        </div>

        <ColumnManager
          columns={columns}
          metadata={metadata}
          onChange={onColumnsChange}
          trigger={
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Fields
            </Button>
          }
        />
      </div>

      {isError ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="Could not load these tasks"
          description="The filter may name a field that has since been removed."
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={debounced ? 'Nothing matches that search' : 'No tasks yet'}
          description={
            debounced
              ? 'Try a different term, or clear the search.'
              : 'Add a task on the board to see it here.'
          }
        />
      ) : (
        // The table scrolls inside its own container rather than the page, so
        // a wide column set never pushes the whole layout sideways.
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                {columns.map((column) => (
                  <th
                    key={column.field}
                    scope="col"
                    className={cn(
                      'px-3 py-2 text-xs font-medium text-muted-foreground',
                      // The task name is what a reader scans, so it stays put
                      // while the rest scrolls.
                      column.field === SystemField.TITLE &&
                        'sticky left-0 z-10 bg-muted/40 min-w-[240px]',
                    )}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    {columnLabel(column.field, metadata)}
                  </th>
                ))}
              </tr>
            </thead>

            {groups.map((group) => (
              <tbody key={group.id}>
                <tr className="border-b border-border bg-muted/20">
                  <th
                    scope="colgroup"
                    colSpan={columns.length}
                    className="px-3 py-1.5 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(group.id)}
                      aria-expanded={!collapsed.has(group.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"
                    >
                      {collapsed.has(group.id) ? (
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      )}
                      {group.name}
                      <span className="font-normal text-muted-foreground">
                        {group.tasks.length}
                      </span>
                    </button>
                  </th>
                </tr>

                {!collapsed.has(group.id) &&
                  group.tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      {columns.map((column) => (
                        <td
                          key={column.field}
                          className={cn(
                            'px-3 py-2 align-middle',
                            column.field === SystemField.TITLE &&
                              'sticky left-0 z-10 bg-background',
                          )}
                        >
                          <Cell
                            task={task}
                            field={column.field}
                            metadata={metadata}
                            onOpen={() => onOpenTask(task.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

function Cell({
  task,
  field,
  metadata,
  onOpen,
}: {
  task: Task;
  field: string;
  metadata: ProjectFieldMetadata | undefined;
  onOpen: () => void;
}) {
  switch (field) {
    case SystemField.TITLE:
      return (
        <button
          type="button"
          onClick={onOpen}
          // Opens the existing task dialog rather than a second editor. One
          // task editor, reached from wherever the task is shown.
          className={cn(
            'text-left font-medium text-foreground hover:underline',
            task.status === TaskStatus.DONE && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </button>
      );

    case SystemField.ASSIGNEE:
      return task.assignee ? (
        <span className="inline-flex items-center gap-1.5">
          <Avatar className="size-5">
            {task.assignee.avatarUrl && <AvatarImage src={task.assignee.avatarUrl} alt="" />}
            <AvatarFallback className="text-[9px]">
              {initials(task.assignee.name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs">{task.assignee.name}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Unassigned</span>
      );

    case SystemField.STATUS:
      return <TaskStatusBadge status={task.status} />;

    case SystemField.PRIORITY:
      return <TaskPriorityBadge priority={task.priority} />;

    case SystemField.DUE_DATE:
      return task.dueDate ? (
        <span className="text-xs">{formatDate(task.dueDate)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      );

    case SystemField.SECTION: {
      const section = metadata?.sections.find((entry) => entry.id === task.sectionId);
      return <span className="text-xs">{section?.name ?? '—'}</span>;
    }

    case SystemField.START_DATE:
      return <span className="text-xs">{task.startDate ? formatDate(task.startDate) : '—'}</span>;

    case SystemField.COMPLETED_AT:
      return (
        <span className="text-xs">{task.completedAt ? formatDate(task.completedAt) : '—'}</span>
      );

    case SystemField.CREATED_AT:
      return <span className="text-xs">{formatDate(task.createdAt)}</span>;

    case SystemField.ESTIMATE:
      return (
        <span className="text-xs tabular-nums">
          {task.estimatedMinutes ? `${task.estimatedMinutes}m` : '—'}
        </span>
      );

    default:
      // A custom field, or a column whose field has since been archived. Shown
      // as blank rather than crashing the row — a missing cell is recoverable,
      // a thrown render is not.
      return <span className="text-xs text-muted-foreground">—</span>;
  }
}

interface Group {
  id: string;
  name: string;
  tasks: Task[];
}

/**
 * Groups rows by section, keeping the project's section order.
 *
 * Tasks with no section land in a trailing group rather than being hidden —
 * a task that is invisible in the only view that lists everything is a task
 * nobody will find again.
 */
function groupBySection(tasks: Task[], metadata: ProjectFieldMetadata | undefined): Group[] {
  const sections = metadata?.sections ?? [];
  const bySection = new Map<string, Task[]>();

  for (const task of tasks) {
    const key = task.sectionId ?? '__none__';
    const bucket = bySection.get(key);
    if (bucket) bucket.push(task);
    else bySection.set(key, [task]);
  }

  const groups: Group[] = sections
    .filter((section) => bySection.has(section.id))
    .map((section) => ({
      id: section.id,
      name: section.name,
      tasks: bySection.get(section.id) ?? [],
    }));

  const orphans = bySection.get('__none__');
  if (orphans?.length) {
    groups.push({ id: '__none__', name: 'No section', tasks: orphans });
  }

  return groups;
}

/**
 * Debounce without pulling in a dependency for one call site.
 *
 * `useEffect`, not `useMemo` — a memo does not run the cleanup it is handed, so
 * every keystroke would leave a live timer and the search would fire once per
 * character after a delay rather than once at the end.
 */
function useDebouncedValue(value: string, onSettled: (value: string) => void) {
  useEffect(() => {
    const timer = setTimeout(() => onSettled(value.trim()), 300);
    return () => clearTimeout(timer);
    // `onSettled` is a `useState` setter, which React guarantees is stable —
    // including it would be honest but adds a dependency that never changes.
  }, [value, onSettled]);
}
