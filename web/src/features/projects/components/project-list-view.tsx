import { SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata, Task, TaskCustomFieldValue, ViewColumn } from '@coretask/types';

/** A task as this view receives it — the task plus its field values. */
type TaskRow = Task & { customFieldValues?: TaskCustomFieldValue[] };
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpdateTask } from '@/features/tasks/hooks/use-tasks';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { cn, formatDate } from '@/lib/utils';

import {
  useFieldMetadata,
  useSetCustomFieldValue,
  useSubtasks,
  useViewTasks,
} from '../hooks/use-project-views';
import { useRenameSection } from '../hooks/use-projects';
import {
  ADD_COLUMN_WIDTH,
  columnWidth,
  pinnedLayout,
  type PinnedLayout,
} from '../lib/column-layout';
import { groupBySection, ORPHAN_GROUP_ID, type Group } from '../lib/group-by-section';
import { CustomFieldCell } from './cells/custom-field-cell';
import { useCellEditor } from './cells/use-cell-editor';
import {
  AssigneeCell,
  DueDateCell,
  PriorityCell,
  StatusCell,
  TitleCell,
} from './cells/system-cells';


import { FieldPickerPopover } from './field-picker/field-picker-popover';
import { ColumnHeaderTable } from './column-header';
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
  columns: allColumns,
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
  const renameSection = useRenameSection(workspaceId, projectId);

  /*
   * Horizontal scroll is tracked so the frozen column can grow a shadow only
   * once something is actually hidden behind it. A permanent shadow reads as a
   * visual seam; one that appears on scroll says "there is more this way".
   */
  const [scrolled, setScrolled] = useState(false);

  const tasks = useMemo(() => data?.items ?? [], [data]);

  const groups = useMemo(() => groupBySection(tasks, metadata), [tasks, metadata]);

  /*
   * The Section column is dropped, however a saved view came by it.
   *
   * Every row already sits inside a card headed by its section, so the column
   * repeated the same word down the page and cost a column's width to do it.
   * Filtered here rather than migrated away, because a view is presentation:
   * rewriting stored settings to remove a column somebody can no longer see
   * would be a migration with nothing to gain.
   */
  const columns = useMemo(
    () => allColumns.filter((column) => column.field !== SystemField.SECTION),
    [allColumns],
  );

  /*
   * The width under the cursor mid-drag, before it is saved.
   *
   * Held here rather than in the handle, because every table has to follow the
   * drag together: a header that widens while the rows below it do not is worse
   * feedback than none. On release the real column is written and this clears.
   */
  const [resizing, setResizing] = useState<{ field: string; width: number } | null>(null);

  const shown = useMemo(
    () =>
      resizing
        ? columns.map((column) =>
            column.field === resizing.field ? { ...column, width: resizing.width } : column,
          )
        : columns,
    [columns, resizing],
  );

  // Pinned offsets and the grid's width come from the same pass, so the frozen
  // block and the scroll container can never disagree about how wide a column is.
  const pinned: PinnedLayout = useMemo(() => pinnedLayout(shown), [shown]);

  /*
   * The grid is its own scrolling pane, sized to reach the bottom of the
   * window.
   *
   * Letting the page scroll instead put the horizontal scrollbar at the bottom
   * of the *content*, so seeing the right-hand columns of a long project meant
   * first scrolling past every task to find the bar. Anchored here, the bar is
   * always on screen and the column header can stay stuck to the top.
   *
   * The height is written straight to the node rather than held in state: this
   * runs on every resize, and a state update per resize frame re-renders the
   * whole grid for a number that only ever lands in one style property.
   *
   * A callback ref, not an effect watching some stand-in for "the pane exists
   * yet". Field metadata is cached for a minute, so arriving from another page
   * renders the section list before the tasks finish loading — any dependency
   * derived from the data has already settled by the time the pane mounts, and
   * the effect never runs again to size it. A callback ref fires on the one
   * event that actually matters, which is the node appearing.
   */
  const paneRef = useCallback((pane: HTMLDivElement | null) => {
    if (!pane) return;

    const fit = () => {
      const { top } = pane.getBoundingClientRect();
      // A floor, so a short window leaves something usable rather than a sliver.
      pane.style.maxHeight = `${Math.max(240, window.innerHeight - top - 16)}px`;
    };

    fit();
    window.addEventListener('resize', fit);

    // The pane's top moves when anything above it changes height — the search
    // row wrapping on a narrow window, for instance.
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);

    return () => {
      window.removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, []);

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
        /*
         * One scroll container around every card, not one per card.
         *
         * Cards that scrolled independently would drift out of step the moment
         * anyone moved sideways, so the columns would only line up until they
         * were used. A single container also keeps one scrollbar and one
         * `scrolled` flag driving the frozen column's shadow.
         */
        <div
          ref={paneRef}
          onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
          className="overflow-auto rounded-lg"
        >
          <div className="space-y-3 pb-1" style={{ minWidth: pinned.totalWidth }}>
            {/*
             * The column header sits above the cards rather than repeating
             * inside each one: the columns are a property of the view, not of
             * any one section, and repeating them turns a long project into a
             * page of headers.
             *
             * Sticky to the top of the pane, because a header that scrolls away
             * leaves you reading unlabelled columns.
             */}
            {/* Wrapped in a box with the cards' border, made transparent: the
                header has to sit in the same geometry as the tables it labels,
                or every column is off by the card's one-pixel border. */}
            <div className="sticky top-0 z-30 rounded-lg border border-transparent bg-background">
              <ColumnHeaderTable
                columns={shown}
                metadata={metadata}
                canEdit={canEdit}
                pinned={{ ...pinned, scrolled }}
                onChange={onColumnsChange}
                onResizePreview={setResizing}
                widths={<ColumnWidths columns={shown} />}
                addControl={
                  canEdit ? (
                    <FieldPickerPopover
                      columns={columns}
                      workspaceId={workspaceId}
                      projectId={projectId}
                      onChange={onColumnsChange}
                    />
                  ) : (
                    // The column still exists for someone who cannot add
                    // fields, because its width is what keeps the cards
                    // aligned with this header.
                    <span className="sr-only">Actions</span>
                  )
                }
              />
            </div>

            {groups.map((group) => (
              /*
               * No `overflow-hidden` on the card, tempting as it is for the
               * rounded corners: an overflow ancestor between a sticky cell and
               * the scroll container silently stops the cell sticking, and the
               * frozen column would scroll away with everything else.
               */
              <section
                key={group.id}
                aria-label={group.name}
                className="rounded-lg border border-border bg-card shadow-sm"
              >
                <h3 className="border-b border-border px-3 py-2">
                  {/* Sticky so a section's name stays readable once the table
                      has been scrolled sideways past it. */}
                  <span className="sticky left-3 flex w-fit items-center gap-1.5">
                    <SectionHeader
                      group={group}
                      collapsed={collapsed.has(group.id)}
                      canEdit={canEdit}
                      onToggle={() => toggle(group.id)}
                      onRename={(name) => renameSection.mutate({ sectionId: group.id, name })}
                    />
                  </span>
                </h3>

                {!collapsed.has(group.id) && (
                  <table className="w-full table-fixed text-sm">
                    <ColumnWidths columns={shown} />
                    <tbody>
                      {group.tasks.length === 0 && (
                        <tr>
                          <td
                            colSpan={shown.length + 2}
                            className="px-3 py-3 text-xs italic text-muted-foreground"
                          >
                            <span className="sticky left-3">No tasks in this section</span>
                          </td>
                        </tr>
                      )}

                      {group.tasks.map((task) => (
                        <TaskRows
                          key={task.id}
                          task={task}
                          workspaceId={workspaceId}
                          projectId={projectId}
                          columns={shown}
                          metadata={metadata}
                          canEdit={canEdit}
                          pinned={{ ...pinned, scrolled }}
                          onOpenTask={onOpenTask}
                          onSaveTask={(taskId, payload) =>
                            updateTask.mutate({ taskId, payload: payload as never })
                          }
                          onSaveField={(taskId, fieldId, value) =>
                            setFieldValue.mutate({ taskId, fieldId, value })
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  workspaceId: string | undefined;
  projectId: string;
  columns: ViewColumn[];
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  pinned: PinnedLayout & { scrolled: boolean };
  onOpenTask: (taskId: string) => void;
  onSaveTask: (taskId: string, payload: Record<string, unknown>) => void;
  onSaveField: (taskId: string, fieldId: string, value: Record<string, unknown>) => void;
}

/**
 * One task, and its subtasks once somebody asks for them.
 *
 * A component per row rather than rows built in a loop, because the expand
 * state and the fetch it triggers belong to the row that owns them. Nesting is
 * one level deep, so a subtask renders as a plain row: no recursion, and no
 * expander on a row that can never have children.
 */
function TaskRows({ task, ...shared }: RowProps & { task: TaskRow }) {
  const [expanded, setExpanded] = useState(false);

  const { data: subtasks, isLoading, isError } = useSubtasks(
    shared.workspaceId,
    shared.projectId,
    task.id,
    expanded,
  );

  return (
    <>
      <Row
        {...shared}
        task={task}
        expanded={expanded}
        onToggleExpand={task.subtaskCount > 0 ? () => setExpanded((open) => !open) : undefined}
      />

      {/* The row stays expanded while its children load, so the chevron does
          not appear to do nothing on a slow connection. */}
      {expanded && isLoading && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={shared.columns.length + 1} className="py-2 pl-11 pr-3">
            <span className="sticky left-11 flex items-center gap-2">
              <Skeleton className="h-4 w-48" />
            </span>
          </td>
        </tr>
      )}

      {expanded && isError && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={shared.columns.length + 1} className="py-2 pl-11 pr-3">
            <span className="sticky left-11 text-xs text-destructive">
              Could not load these subtasks.
            </span>
          </td>
        </tr>
      )}

      {expanded &&
        subtasks?.map((subtask) => (
          <Row key={subtask.id} {...shared} task={subtask as TaskRow} depth={1} />
        ))}
    </>
  );
}

/** One `<tr>`. Shared by parents and subtasks so a row means the same thing. */
function Row({
  task,
  depth = 0,
  expanded,
  onToggleExpand,
  columns,
  metadata,
  canEdit,
  pinned,
  onOpenTask,
  onSaveTask,
  onSaveField,
}: RowProps & {
  task: TaskRow;
  depth?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <tr className="group border-b border-border last:border-0 hover:bg-muted/30">
      {columns.map((column) => {
        // A pinned cell's offset has to match its header's exactly, so both read
        // it from the same layout pass rather than each working it out.
        const left = pinned.offsets.get(column.field);

        return (
          <td
            key={column.field}
            style={left === undefined ? undefined : { left }}
            className={cn(
              'px-3 py-2 align-middle',
              left !== undefined && 'sticky z-10 bg-card',
              column.field === pinned.lastPinned &&
                pinned.scrolled &&
                'after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-gradient-to-r after:from-black/10 after:to-transparent',
            )}
          >
          <Cell
            task={task}
            field={column.field}
            metadata={metadata}
            canEdit={canEdit}
            depth={depth}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            onOpen={() => onOpenTask(task.id)}
              onSaveTask={(payload) => onSaveTask(task.id, payload)}
              onSaveField={(fieldId, value) => onSaveField(task.id, fieldId, value)}
            />
          </td>
        );
      })}

      {/* Empty, but present: these hold the row to the same number of cells as
          the header, so neither the `+` column nor the trailing spacer pushes
          anything out of line. */}
      <td aria-hidden="true" />
      <td aria-hidden="true" />
    </tr>
  );
}

/**
 * A section's name, collapse control and task count.
 *
 * Clicking the name edits it, the way it does in the board — the chevron is a
 * separate control so collapsing and renaming never fight over the same click.
 * The synthetic "No section" group is not a real section, so it has no name to
 * rename and gets plain text.
 */
function SectionHeader({
  group,
  collapsed,
  canEdit,
  onToggle,
  onRename,
}: {
  group: Group;
  collapsed: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
}) {
  const isRealSection = group.id !== ORPHAN_GROUP_ID;

  const editor = useCellEditor(group.name, (name) => {
    const trimmed = name.trim();
    // A nameless section cannot be told apart from its neighbours, so an empty
    // name reverts rather than saving.
    if (trimmed) onRename(trimmed);
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editor.editing) inputRef.current?.select();
  }, [editor.editing]);

  const count = (
    <span className="rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground">
      {group.tasks.length}
    </span>
  );

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.name}`}
        className="cursor-pointer rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        {collapsed ? (
          <ChevronRight className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </button>

      {editor.editing ? (
        <Input
          ref={inputRef}
          value={editor.draft}
          onChange={(event) => editor.setDraft(event.target.value)}
          onBlur={editor.commit}
          onKeyDown={editor.onKeyDown}
          aria-label={`Rename ${group.name}`}
          className="h-7 w-48 text-sm font-semibold"
        />
      ) : canEdit && isRealSection ? (
        <button
          type="button"
          onClick={editor.open}
          aria-label={`Rename ${group.name}`}
          className="cursor-pointer rounded px-1 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {group.name}
        </button>
      ) : (
        <span className="px-1 text-sm font-semibold text-foreground">{group.name}</span>
      )}

      {count}
    </>
  );
}

/*
 * Splitting sections into separate tables means each one would otherwise size
 * its own columns from its own content, so a card holding short titles would
 * not line up with the card above it. Every table declares the same widths and
 * `table-fixed`, which makes the stack read as one grid.
 */
function ColumnWidths({ columns }: { columns: ViewColumn[] }) {
  return (
    <colgroup>
      {columns.map((column) => (
        <col key={column.field} style={{ width: columnWidth(column) }} />
      ))}
      <col style={{ width: ADD_COLUMN_WIDTH }} />
      <col />
    </colgroup>
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
  depth,
  expanded,
  onToggleExpand,
  onOpen,
  onSaveTask,
  onSaveField,
}: {
  task: TaskRow;
  field: string;
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  depth?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onOpen: () => void;
  onSaveTask: (payload: Record<string, unknown>) => void;
  onSaveField: (fieldId: string, payload: Record<string, unknown>) => void;
}) {
  const shared = {
    task,
    metadata,
    canEdit,
    onSave: onSaveTask,
    onOpenTask: onOpen,
  };

  switch (field) {
    case SystemField.TITLE:
      // Indent and the expander live on the title, the only column where the
      // hierarchy means anything.
      return (
        <TitleCell
          {...shared}
          depth={depth}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      );
    case SystemField.ASSIGNEE:
      return <AssigneeCell {...shared} />;
    case SystemField.STATUS:
      return <StatusCell {...shared} />;
    case SystemField.PRIORITY:
      return <PriorityCell {...shared} />;
    case SystemField.DUE_DATE:
      return <DueDateCell {...shared} />;

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

