import { SystemField } from '@coretask/contracts';
import type {
  ProjectFieldMetadata,
  Task,
  TaskCustomFieldValue,
  ViewColumn,
} from '@coretask/types';

/** A task as this view receives it — the task plus its field values. */
type TaskRow = Task & { customFieldValues?: TaskCustomFieldValue[] };
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpdateTask } from '@/features/tasks/hooks/use-tasks';
import { cn, formatDate } from '@/lib/utils';

import {
  useFieldMetadata,
  useSetCustomFieldValue,
  useViewTasks,
} from '../hooks/use-project-views';
import { groupBySection } from '../lib/group-by-section';
import { CustomFieldCell } from './cells/custom-field-cell';
import {
  AssigneeCell,
  DueDateCell,
  PriorityCell,
  StatusCell,
  TitleCell,
} from './cells/system-cells';

import { columnLabel } from '../lib/column-labels';

import { ColumnManager } from './column-manager';

interface ProjectListViewProps {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
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
  canEdit,
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
  const updateTask = useUpdateTask(workspaceId);
  const setFieldValue = useSetCustomFieldValue(workspaceId, projectId);

  /*
   * Horizontal scroll is tracked so the frozen column can grow a shadow only
   * once something is actually hidden behind it. A permanent shadow reads as a
   * visual seam; one that appears on scroll says "there is more this way".
   */
  const [scrolled, setScrolled] = useState(false);

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
      ) : groups.length === 0 || (debounced && tasks.length === 0) ? (
        /*
         * Only when there is genuinely nothing to show — no tasks *and* no
         * sections to put them in. A project with sections renders its table
         * even while empty, because the sections are the answer to "where does
         * a task go?". A search that matches nothing is the exception: a wall
         * of empty sections hides the fact that the term found nothing.
         */
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
        <div
          onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
          className="overflow-x-auto rounded-lg border border-border"
        >
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
                        'sticky left-0 z-20 min-w-[240px] bg-muted/40',
                      column.field === SystemField.TITLE &&
                        scrolled &&
                        'after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-gradient-to-r after:from-black/10 after:to-transparent',
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

                {!collapsed.has(group.id) && group.tasks.length === 0 && (
                  <tr className="border-b border-border last:border-0">
                    <td
                      colSpan={columns.length}
                      className="px-3 py-2 text-xs italic text-muted-foreground"
                    >
                      No tasks in this section
                    </td>
                  </tr>
                )}

                {!collapsed.has(group.id) &&
                  group.tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="group border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      {columns.map((column) => (
                        <td
                          key={column.field}
                          className={cn(
                            'px-3 py-2 align-middle',
                            column.field === SystemField.TITLE &&
                              'sticky left-0 z-10 bg-background',
                            column.field === SystemField.TITLE &&
                              scrolled &&
                              'after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-gradient-to-r after:from-black/10 after:to-transparent',
                          )}
                        >
                          <Cell
                            task={task}
                            field={column.field}
                            metadata={metadata}
                            canEdit={canEdit}
                            onOpen={() => onOpenTask(task.id)}
                            onSaveTask={(payload) =>
                              updateTask.mutate({ taskId: task.id, payload: payload as never })
                            }
                            onSaveField={(fieldId, payload) =>
                              setFieldValue.mutate({ taskId: task.id, fieldId, value: payload })
                            }
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

/**
 * One cell, editable in place.
 *
 * System fields have bespoke editors; everything else dispatches on the field
 * *definition's* type. That split is what stops a new field type meaning a new
 * table component.
 */
function Cell({
  task,
  field,
  metadata,
  canEdit,
  onOpen,
  onSaveTask,
  onSaveField,
}: {
  task: TaskRow;
  field: string;
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  onOpen: () => void;
  onSaveTask: (payload: Record<string, unknown>) => void;
  onSaveField: (fieldId: string, payload: Record<string, unknown>) => void;
}) {
  const shared = { task, metadata, canEdit, onSave: onSaveTask, onOpenTask: onOpen };

  switch (field) {
    case SystemField.TITLE:
      return <TitleCell {...shared} />;
    case SystemField.ASSIGNEE:
      return <AssigneeCell {...shared} />;
    case SystemField.STATUS:
      return <StatusCell {...shared} />;
    case SystemField.PRIORITY:
      return <PriorityCell {...shared} />;
    case SystemField.DUE_DATE:
      return <DueDateCell {...shared} />;

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

    default: {
      const fieldId = field.startsWith('custom:') ? field.slice('custom:'.length) : null;
      const definition = fieldId
        ? metadata?.customFields.find((entry) => entry.id === fieldId)
        : undefined;

      // A column whose field was archived or removed. Blank rather than a
      // thrown render — a missing cell is recoverable, a broken row is not.
      if (!definition) return <span className="text-xs text-muted-foreground">—</span>;

      return (
        <CustomFieldCell
          field={definition}
          value={task.customFieldValues?.find((entry) => entry.customFieldId === definition.id)}
          metadata={metadata}
          canEdit={canEdit}
          taskTitle={task.title}
          onSave={(payload) => onSaveField(definition.id, payload)}
        />
      );
    }
  }
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
