import {
  SystemField,
  TaskStatus,
  type CreatableWorkItemType,
  type WorkItemType,
} from '@coretask/contracts';
import type {
  BulkWorkItemPayload,
  ProjectFieldMetadata,
  Task,
  TaskCustomFieldValue,
  ViewColumn,
  ViewSettings,
} from '@coretask/types';

/** A task as this view receives it — the task plus its field values. */
type TaskRow = Task & { customFieldValues?: TaskCustomFieldValue[] };
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMoveTaskToSection } from '@/features/tasks/hooks/use-tasks';
import { resolveTaskDrop, type TaskGroups } from '@/features/tasks/lib/resolve-task-drop';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { SHORTCUT_PRIORITY, useShortcutActions } from '@/lib/shortcuts/shortcut-registry';
import { calendarDateFromNow, cn, formatDate } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { useFieldMetadata, useSetCustomFieldValue, useSubtasks } from '../hooks/use-project-views';
import { useCreateSection, useProject, useRenameSection } from '../hooks/use-projects';
import {
  ADD_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_TITLE_WIDTH,
  columnWidth,
  isFixedColumn,
  pinnedLayout,
  visibleColumns,
  type PinnedLayout,
} from '../lib/column-layout';
import { columnLabel, columnMinWidth } from '../lib/column-labels';
import { textWidth } from '@/lib/text-width';

/*
 * The floor for the Name column tracks the widest section header: chevron,
 * name and lightning have to fit inside the first column, or the header
 * spills across the gridline into Assignee. Text is measured with the
 * header's own font; the fallback estimate covers environments without
 * canvas, like the test runner.
 */
const SECTION_HEADER_CHROME = 104;

function sectionLabelWidth(text: string): number {
  return textWidth(text, '600 14px');
}
import { ORPHAN_GROUP_ID } from '../lib/group-by-section';
import { SectionLinkItems } from './section-link-items';
import { groupRows, type RowGroup } from '../lib/group-rows';
import { groupValueChange, isManualOrder } from '../lib/group-value';
import { DEFAULT_VIEW_SETTINGS } from '../lib/view-settings';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import {
  escapeBelongsElsewhere,
  isInteractiveTarget,
  rangeBetween,
  toggle as toggleSelected,
  visibleOrder,
} from '../lib/selection';
import { BulkActionBar, type BulkActionBarHandle } from './bulk-action-bar';
import { ListDndContext, RowDragHandle, SectionDropZone } from './list-row-dnd';
import { useRowDropTarget } from './use-row-drop-target';
import { SectionAutomationPopover } from '@/features/automations/components/section-automation-popover';
import { CreateSectionDialog } from './create-section-dialog';
import { CreateWorkItemDialog } from '@/features/work-items/components/create-work-item-dialog';
import { ProjectWorkItemCreateButton } from '@/features/work-items/components/project-work-item-create-button';
import {
  QuickCreateWorkItemRow,
  type QuickCreateWorkItemRowHandle,
} from '@/features/work-items/components/quick-create-work-item-row';
import {
  useBulkUpdateWorkItems,
  useCreateProjectWorkItem,
  useProjectWorkItems,
  useUpdateProjectWorkItem,
} from '@/features/work-items/hooks/use-project-work-items';
import { toWorkItemUpdate } from '@/features/work-items/lib/cell-payload';
import {
  isTicketRow,
  toWorkItemRow,
  type WorkItemRow,
} from '@/features/work-items/lib/work-item-row';
import { ViewToolbar } from './view-toolbar-slot';
import { CustomFieldCell } from './cells/custom-field-cell';
import { EmptyCell } from './cells/editable-cell';
import { useCellEditor } from './cells/use-cell-editor';
import {
  AssigneeCell,
  DueDateCell,
  PriorityCell,
  StartDateCell,
  StatusCell,
  TitleCell,
} from './cells/system-cells';

import { EditCustomFieldDialog } from './field-picker/edit-custom-field-dialog';
import { FieldPickerPopover } from './field-picker/field-picker-popover';
import { ColumnHeaderTable } from './column-header';
import { ViewToolbarControls } from './toolbar/view-toolbar-controls';

/** The selected rows and the last plain click, which a shift range extends from. */
interface Selection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

const NO_SELECTION: Selection = { ids: new Set(), anchor: null };

/*
 * A selected row's tint, mixed solid rather than laid over: the frozen title
 * cell has to stay opaque to cover the gridlines behind it, and a translucent
 * tint would let a line show through it once the grid is scrolled.
 */
const SELECTED_BG = 'bg-[color-mix(in_oklab,var(--color-primary)_10%,var(--color-background))]';
const SELECTED_BG_HOVER =
  'hover:bg-[color-mix(in_oklab,var(--color-primary)_16%,var(--color-background))]';

interface ProjectListViewProps {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
  /** Whether the bulk bar offers Archive — the task route's MANAGER rule. */
  canArchive?: boolean;
  columns: ViewColumn[];
  onColumnsChange: (columns: ViewColumn[]) => void;
  onOpenTask: (taskId: string) => void;
  /** The open view's settings; the toolbar edits them through `onSettingsChange`. */
  settings?: ViewSettings;
  onSettingsChange?: ((patch: Partial<ViewSettings>) => void) | undefined;
  /** Whether a change is written to the view, or kept as a draft to save as a new one. */
  canPersist?: boolean;
  dirty?: boolean;
  onSaveAs?: (() => void) | undefined;
  /** The section named in the URL, if any; clicking a header selects it. */
  selectedSectionId?: string | null;
  onSelectSection?: ((sectionId: string) => void) | undefined;
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
  canArchive = false,
  columns: allColumns,
  onColumnsChange,
  onOpenTask,
  settings = DEFAULT_VIEW_SETTINGS,
  onSettingsChange,
  canPersist = true,
  dirty = false,
  onSaveAs,
  selectedSectionId = null,
  onSelectSection,
}: ProjectListViewProps) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  // Asana keeps the search as a bare icon until it is needed.
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /*
   * Asana's multi-select: click a row, shift-click a range, ctrl-click to add
   * one. The anchor is the last plain click, which is what a shift range
   * extends from. Held as ids rather than rows so a refetch cannot leave the
   * selection pointing at stale objects.
   */
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const selected = selection.ids;
  const bulkBarRef = useRef<BulkActionBarHandle>(null);
  /** The first section's add row — where Tab+N lands. */
  const firstRowRef = useRef<QuickCreateWorkItemRowHandle>(null);
  const me = useCurrentUser();

  /*
   * A different project, or a different search, is a different set of rows; a
   * selection made against the old one would act on rows nobody can see.
   * Reset during render rather than in an effect, so the stale set never
   * reaches the screen for a frame.
   */
  const [selectionScope, setSelectionScope] = useState({ projectId, search: debounced });
  if (selectionScope.projectId !== projectId || selectionScope.search !== debounced) {
    setSelectionScope({ projectId, search: debounced });
    setSelection(NO_SELECTION);
  }

  /** Non-null while the fuller create form is open, holding what it starts from. */
  const [composing, setComposing] = useState<{
    type: CreatableWorkItemType;
    sectionId?: string | undefined;
  } | null>(null);

  // Debounced so typing does not fire a request per keystroke.
  useDebouncedValue(search, setDebounced);

  // A stable ref, so it focuses when the input appears — not on every render.
  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  /*
   * The shared work-item query, not the task-only one.
   *
   * This is what makes a ticket created here actually appear here. Reading
   * tasks alone meant filing a ticket from the List made it vanish — present in
   * the database, absent from the only screen that had just created it.
   */
  const { data, isLoading, isError } = useProjectWorkItems(workspaceId, projectId, {
    ...(debounced ? { search: debounced } : {}),
    includeCustomFields: true,
    // The view's settings ride on the request, so a change applies at once —
    // whether or not this person may save it.
    ...(settings.filters.conditions.length > 0 ? { filters: settings.filters.conditions } : {}),
    ...(settings.sorts.length > 0 ? { sorts: settings.sorts } : {}),
    ...(settings.groupBy && settings.groupBy !== SystemField.SECTION
      ? { groupBy: settings.groupBy }
      : {}),
    ...(settings.showCompleted === false ? { showCompleted: false } : {}),
  });
  const filtersActive = settings.filters.conditions.length > 0 || settings.showCompleted === false;
  const manualOrder = isManualOrder(settings);
  const { data: metadata } = useFieldMetadata(workspaceId, projectId);
  const setFieldValue = useSetCustomFieldValue(workspaceId, projectId);
  const renameSection = useRenameSection(workspaceId, projectId);
  const moveTask = useMoveTaskToSection(workspaceId);
  const createWorkItem = useCreateProjectWorkItem(workspaceId, projectId);
  const createSection = useCreateSection(workspaceId, projectId);
  const updateWorkItem = useUpdateProjectWorkItem(workspaceId, projectId);
  const bulk = useBulkUpdateWorkItems(workspaceId, projectId);
  const [addingSection, setAddingSection] = useState(false);
  /** The custom field whose edit dialog is open, by id. */
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const { data: project } = useProject(workspaceId, projectId);

  const editingField = metadata?.customFields.find((field) => field.id === editingFieldId);

  // `TASK` until the project loads, which is what it was before this existed.
  const defaultType: CreatableWorkItemType = project?.defaultWorkItemType ?? 'TASK';

  /** Every create in this view goes through here, whatever opened it. */
  const create = async (input: {
    type: WorkItemType;
    title: string;
    sectionId?: string | undefined;
    parentId?: string | undefined;
  }) =>
    createWorkItem.mutateAsync({
      type: input.type,
      title: input.title,
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    });

  /*
   * Horizontal scroll is tracked so the frozen column can grow a shadow only
   * once something is actually hidden behind it. A permanent shadow reads as a
   * visual seam; one that appears on scroll says "there is more this way".
   */
  const [scrolled, setScrolled] = useState(false);

  /*
   * Converted at the boundary — see `toWorkItemRow`. The cells were written
   * against `Task`, and rewriting a dozen of them in the same change that puts
   * tickets in the grid would make one large diff out of two separate risks.
   */
  const tasks = useMemo(() => (data?.items ?? []).map(toWorkItemRow), [data]);

  const groups = useMemo(
    () => groupRows(tasks, settings.groupBy, metadata),
    [tasks, settings.groupBy, metadata],
  );

  /**
   * Gives a row the value a group stands for: a status, an assignee, a
   * select option. The move is the section case; the rest are edits.
   */
  const applyGroupValue = (group: RowGroup, row: TaskRow) => {
    const change = groupValueChange(settings.groupBy, group, row as WorkItemRow, metadata);
    if (!change) return;
    switch (change.kind) {
      case 'move':
        moveTask.mutate({
          taskId: row.id,
          payload: { sectionId: change.sectionId, afterTaskId: null },
        });
        return;
      case 'update':
        updateWorkItem.mutate({ workItemId: row.id, payload: change.payload });
        return;
      case 'field':
        setFieldValue.mutate({ taskId: row.id, fieldId: change.fieldId, value: change.payload });
        return;
      case 'refused':
        toast.error(change.reason);
    }
  };

  /** The rows as drawn, for shift ranges; the selection, as rows, for the bar. */
  const order = useMemo(() => visibleOrder(groups, collapsed), [groups, collapsed]);
  const selectedRows = useMemo(
    () => tasks.filter((task) => selected.has(task.id)),
    [tasks, selected],
  );
  // The project's first section, whatever the rows are grouped by: it is
  // where a row added under a value heading is filed before the value is set.
  const firstSectionId =
    metadata?.sections[0]?.id ??
    groups.find((group) => group.kind === 'section' && group.id !== ORPHAN_GROUP_ID)?.id;

  /** What the Name column may never shrink past — see `sectionLabelWidth`. */
  const titleMinWidth = useMemo(() => {
    const widest = groups.reduce((max, group) => Math.max(max, sectionLabelWidth(group.name)), 0);
    return Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(MIN_TITLE_WIDTH, Math.ceil(widest) + SECTION_HEADER_CHROME),
    );
  }, [groups]);

  /*
   * See `visibleColumns`: a saved view outlives what it points at. Widths are
   * also floored per label here — see `columnMinWidth` — so a column saved
   * narrower than its own header still draws a readable word, not a letter.
   */
  const columns = useMemo(
    () =>
      visibleColumns(allColumns, metadata).map((column) => {
        const min = isFixedColumn(column.field)
          ? titleMinWidth
          : columnMinWidth(column.field, metadata);
        return columnWidth(column) < min ? { ...column, width: min } : column;
      }),
    [allColumns, metadata, titleMinWidth],
  );

  /*
   * The width under the cursor mid-drag, before it is saved.
   *
   * Held here rather than in the handle, because every table has to follow the
   * drag together: a header that widens while the rows below it do not is worse
   * feedback than none. On release the real column is written and this clears.
   */
  const [resizing, setResizing] = useState<{ field: string; width: number }[] | null>(null);

  const shown = useMemo(() => {
    if (!resizing) return columns;
    const preview = new Map(resizing.map((entry) => [entry.field, entry.width]));
    return columns.map((column) => {
      const width = preview.get(column.field);
      return width === undefined ? column : { ...column, width };
    });
  }, [columns, resizing]);

  // Pinned offsets and the grid's width come from the same pass, so the frozen
  // block and the scroll container can never disagree about how wide a column is.
  const pinned: PinnedLayout = useMemo(() => pinnedLayout(shown), [shown]);

  /*
   * Where each column ends, for the full-height gridlines. Asana's vertical
   * rules run through the add rows and the gaps — not just the task rows —
   * so they are drawn once behind everything rather than as a border on
   * every cell. The section-header bands are opaque and cover them, as
   * Asana's are: they have to be, to pin below the column header.
   */
  const columnEdges = useMemo(() => {
    const edges: number[] = [];
    let x = 0;
    for (const column of shown) {
      x += columnWidth(column);
      edges.push(x);
    }
    edges.push(x + ADD_COLUMN_WIDTH);
    return edges;
  }, [shown]);

  /** The edge under a live resize — where the blue guide draws. */
  const resizeEdge = useMemo(() => {
    const dragged = resizing?.[0];
    if (!dragged) return null;
    const index = shown.findIndex((column) => column.field === dragged.field);
    return index === -1 ? null : (columnEdges[index] ?? null);
  }, [resizing, shown, columnEdges]);

  /*
   * The overlays (gridlines, resize strips) live in the scrolled content, so
   * a sideways scroll slides them through the frozen block's zone in the
   * gaps and add rows — the grid visibly crossing "behind" the frozen
   * column. They are clipped at the frozen boundary instead, written
   * straight to the nodes on scroll rather than through state, which would
   * re-render the whole grid per frame.
   */
  const linesRef = useRef<HTMLDivElement>(null);
  const stripsRef = useRef<HTMLDivElement>(null);

  const pinnedWidth = useMemo(() => {
    if (!pinned.lastPinned) return 0;
    const column = shown.find((entry) => entry.field === pinned.lastPinned);
    return (pinned.offsets.get(pinned.lastPinned) ?? 0) + (column ? columnWidth(column) : 0);
  }, [pinned, shown]);

  /*
   * A gridline drag resizes the column on its left, exactly as Asana's does:
   * the columns beyond keep their widths and slide along with the edge. The
   * travel is bounded — the general 60px floor, the measured section-header
   * floor for the Name column, 800px at the top — so the line stops rather
   * than crushing what it labels.
   */
  const resizeAdjustments = (
    index: number,
    dx: number,
  ): { field: string; width: number }[] | null => {
    const column = columns[index];
    if (!column) return null;

    const width = columnWidth(column);
    const min = index === 0 ? titleMinWidth : columnMinWidth(column.field, metadata);

    return [
      {
        field: column.field,
        width: Math.min(MAX_COLUMN_WIDTH, Math.max(min, Math.round(width + dx))),
      },
    ];
  };

  const commitResize = (adjustments: { field: string; width: number }[]) => {
    const byField = new Map(adjustments.map((entry) => [entry.field, entry.width]));
    onColumnsChange(
      columns.map((column) => {
        const width = byField.get(column.field);
        return width === undefined ? column : { ...column, width };
      }),
    );
  };

  /*
   * The column header's height, published as a CSS variable for the section
   * bands: each sticky h3 pins at `top: var(--list-header-h)`, which is
   * "directly below the header". Measured rather than hardcoded — the height
   * is intrinsic (label padding on one side, the add-field button on the
   * other), and a table row treats a fixed height as a minimum, so no class
   * can truly pin it. Written to the parent, the grid container, so the
   * header must stay its direct child. Same write-to-the-node idiom as
   * `paneRef` below.
   */
  const headerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const write = () =>
      node.parentElement?.style.setProperty('--list-header-h', `${node.offsetHeight}px`);

    write();
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
      const next = `${Math.max(240, window.innerHeight - top - 16)}px`;

      /*
       * Written only when it actually changes.
       *
       * The observer watches the body, and this writes a height that changes
       * the body's — so an unconditional assignment feeds itself: set height,
       * body resizes, observer fires, set height again. It never visibly
       * settled, and anything positioned against the page (a popover, a
       * tooltip) was repositioned on every pass.
       */
      if (pane.style.maxHeight !== next) pane.style.maxHeight = next;
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

  /*
   * Handled by the same resolver the board uses, so a drop means the same thing
   * in both views. Duplicating the arithmetic would be how "dropped onto the
   * third row" comes to mean one position on the board and another here.
   *
   * The orphan group is excluded: it is a synthetic bucket for tasks whose
   * section was removed, not a section anything can be moved into.
   */
  const handleDrop = (
    taskId: string,
    target: { id: string; type: 'task' | 'column'; sectionId?: string },
  ) => {
    if (!canEdit) return;

    /*
     * With a sort or a value grouping in charge, a drop cannot reorder — but
     * a drop into another group still means "give it this value". Within the
     * same group it means nothing, and nothing happens.
     */
    if (!manualOrder) {
      const row = tasks.find((task) => task.id === taskId);
      const destination =
        target.type === 'column'
          ? groups.find((group) => group.id === target.sectionId)
          : groups.find((group) => group.tasks.some((task) => task.id === target.id));
      if (!row || !destination || destination.tasks.some((task) => task.id === taskId)) return;
      applyGroupValue(destination, row);
      return;
    }

    const dropGroups: TaskGroups = Object.fromEntries(
      groups
        .filter((group) => group.id !== ORPHAN_GROUP_ID)
        .map((group) => [group.id, group.tasks]),
    );

    const plan = resolveTaskDrop(dropGroups, taskId, target);
    if (!plan) return;

    moveTask.mutate({
      taskId,
      payload: { sectionId: plan.sectionId, afterTaskId: plan.afterTaskId },
    });
  };

  const toggle = (sectionId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  const clearSelection = useCallback(() => setSelection(NO_SELECTION), []);

  const selectRow = (id: string, modifiers: { shift: boolean; toggle: boolean }) => {
    setSelection((previous) => {
      // A range keeps its anchor, so the next shift-click extends from the
      // same place rather than from the end of the last range.
      if (modifiers.shift) {
        const range = rangeBetween(order, previous.anchor, id);
        return {
          ids: new Set([...(modifiers.toggle ? previous.ids : []), ...range]),
          anchor: previous.anchor ?? id,
        };
      }
      return {
        ids: modifiers.toggle ? toggleSelected(previous.ids, id) : new Set([id]),
        anchor: id,
      };
    });
  };

  /*
   * Escape clears the selection — in the capture phase, so it runs ahead of
   * the task panel's own Escape whatever order the two mounted in. The panel
   * honours `defaultPrevented`, so the first Escape clears and the second
   * closes the panel, which is Asana's order. A field or an open picker under
   * the caret keeps its own Escape.
   */
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (escapeBelongsElsewhere(event.target)) return;
      event.preventDefault();
      clearSelection();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [selected.size, clearSelection]);

  /** One change for every selected row, then the selection is spent. */
  const runBulk = (change: Omit<BulkWorkItemPayload, 'workItemIds'>, verb: string) => {
    const workItemIds = [...selected];
    const ticketCount = selectedRows.filter(isTicketRow).length;
    const noun = ticketCount > 0 ? 'items' : workItemIds.length === 1 ? 'task' : 'tasks';
    // A field value lands on tasks only; the toast says so rather than
    // letting "Set Severity on 4 items" imply the ticket changed too.
    const skipped =
      change.update?.customFieldValues && ticketCount > 0
        ? ` (${ticketCount === 1 ? '1 ticket' : `${ticketCount} tickets`} skipped)`
        : '';
    bulk.mutate(
      { workItemIds, ...change },
      {
        onSuccess: () => {
          clearSelection();
          toast.success(`${verb} ${workItemIds.length} ${noun}${skipped}`);
        },
      },
    );
  };

  const hasSelection = canEdit && selectedRows.length > 0;
  const selectionHasTicket = selectedRows.some(isTicketRow);
  const selectionDone = selectedRows.every((row) => row.status === TaskStatus.DONE);

  /*
   * Asana's chords, for the rows on screen. Tab+N opens the first section's
   * add row; the rest apply to the selection and are offered only while there
   * is one, so with nothing selected the keys fall silent rather than acting
   * on nothing. The task panel registers above this while it is open.
   */
  useShortcutActions(
    {
      newTask: canEdit
        ? () => {
            if (firstRowRef.current) firstRowRef.current.open();
            else setComposing({ type: defaultType });
          }
        : undefined,
      assign: hasSelection ? () => bulkBarRef.current?.openAssignee() : undefined,
      dueDate: hasSelection ? () => bulkBarRef.current?.openDueDate() : undefined,
      assignToMe:
        hasSelection && me
          ? () => runBulk({ update: toWorkItemUpdate({ assigneeId: me.id }) }, 'Assigned')
          : undefined,
      dueToday: hasSelection
        ? () => runBulk({ update: { dueDate: calendarDateFromNow(0), dueAt: null } }, 'Rescheduled')
        : undefined,
      dueTomorrow: hasSelection
        ? () => runBulk({ update: { dueDate: calendarDateFromNow(1), dueAt: null } }, 'Rescheduled')
        : undefined,
      toggleComplete:
        hasSelection && !selectionHasTicket
          ? () =>
              runBulk(
                { update: { statusId: selectionDone ? TaskStatus.TODO : TaskStatus.DONE } },
                'Updated',
              )
          : undefined,
      archive:
        hasSelection && canArchive && !selectionHasTicket
          ? () => bulkBarRef.current?.openArchive()
          : undefined,
    },
    { priority: SHORTCUT_PRIORITY.list },
  );

  return (
    <div className="space-y-3">
      {/* Asana's toolbar row: create on the left, everything else trailing.
          Filter, Sort, Group and Options are honestly inert until saved views
          can hold them. */}
      <ViewToolbar>
        <div className="flex w-full flex-wrap items-center gap-2">
          <ProjectWorkItemCreateButton
            defaultType={defaultType}
            context={{ projectId, sourceView: 'LIST' }}
            pending={createWorkItem.isPending}
            variant="outline"
            onCreate={(type) => setComposing({ type: type as CreatableWorkItemType })}
            onCreateSection={() => setAddingSection(true)}
          />

          <div className="ml-auto flex items-center gap-1">
            <ViewToolbarControls
              viewType="LIST"
              settings={settings}
              metadata={metadata}
              meId={me?.id}
              canPersist={canPersist}
              dirty={dirty}
              onChange={(patch) => onSettingsChange?.(patch)}
              onSaveAs={() => onSaveAs?.()}
            />

            {searchOpen || search !== '' ? (
              <div className="relative w-44">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  // Mount-focused: this branch only appears because somebody
                  // clicked the search icon a moment ago.
                  ref={focusOnMount}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onBlur={() => {
                    if (search === '') setSearchOpen(false);
                  }}
                  placeholder="Search tasks…"
                  aria-label="Search tasks"
                  className="h-8 pl-9"
                />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Search tasks"
                onClick={() => setSearchOpen(true)}
              >
                <Search />
              </Button>
            )}
          </div>
        </div>
      </ViewToolbar>

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
      ) : groups.length === 0 || ((debounced || filtersActive) && tasks.length === 0) ? (
        /*
         * Only when there is genuinely nothing to show — no tasks *and* no
         * sections to put them in. A project with sections renders its table
         * even while empty, because the sections are the answer to "where does
         * a task go?". A search that matches nothing is the exception: a wall
         * of empty sections hides the fact that the term found nothing.
         */
        <EmptyState
          icon={SlidersHorizontal}
          title={
            debounced
              ? 'Nothing matches that search'
              : filtersActive
                ? 'No tasks match these filters'
                : 'No tasks yet'
          }
          description={
            debounced
              ? 'Try a different term, or clear the search.'
              : filtersActive
                ? 'Loosen a filter, or clear them all from the Filter menu.'
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
          onScroll={(event) => {
            const left = event.currentTarget.scrollLeft;
            setScrolled(left > 0);
            // Keep the frozen zone clean — see linesRef above.
            const clip = left > 0 ? `inset(0 0 0 ${left + pinnedWidth}px)` : 'none';
            if (linesRef.current) linesRef.current.style.clipPath = clip;
            if (stripsRef.current) stripsRef.current.style.clipPath = clip;
          }}
          className="overflow-auto"
          data-density={settings.density.toLowerCase()}
        >
          <ListDndContext onDrop={handleDrop}>
            {/* `isolate` so the negative-z gridlines stay inside this box
                instead of vanishing behind the page background. */}
            <div
              className="relative isolate space-y-5 pb-1"
              style={{ minWidth: pinned.totalWidth }}
            >
              {/*
               * The column header sits above the cards rather than repeating
               * inside each one: the columns are a property of the view, not of
               * any one section, and repeating them turns a long project into a
               * page of headers.
               *
               * Sticky to the top of the pane, because a header that scrolls away
               * leaves you reading unlabelled columns.
               *
               * The rule across the top marks where the grid begins — without
               * it the labels float unanchored between the toolbar and the
               * first section.
               */}
              <div
                ref={headerRef}
                className="sticky top-0 z-30 border-y border-border bg-background"
              >
                <ColumnHeaderTable
                  columns={shown}
                  metadata={metadata}
                  canEdit={canEdit}
                  pinned={{ ...pinned, scrolled }}
                  onChange={onColumnsChange}
                  titleMinWidth={titleMinWidth}
                  onEditField={canEdit ? setEditingFieldId : undefined}
                  onResizePreview={(preview) => setResizing(preview ? [preview] : null)}
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
                <SectionDropZone key={group.id} sectionId={group.id}>
                  {({ ref: dropRef, isOver }) => (
                    <section
                      ref={dropRef}
                      aria-label={group.name}
                      className={cn(
                        // Flat in the flow rather than a card, as Asana draws
                        // its sections — the rows' own rules carry the grid.
                        'transition-colors',
                        // Lit while a row hovers it, because a drop with no feedback
                        // is a guess about where the task will land.
                        isOver && 'bg-primary/5',
                      )}
                    >
                      {/*
                       * Sticky on both axes, split across two elements. The h3
                       * is the band: sticky-top, it pins below the column
                       * header while its rows scroll, and the section's own
                       * bottom edge pushes it away — Asana's push-off. Opaque
                       * and full grid width, so rows slide beneath it; z-20
                       * sits above the pinned cells and below the column
                       * header. The span inside is the name: sticky-left, so
                       * it stays readable once the table has been scrolled
                       * sideways; capped at the Name column so a long name
                       * truncates instead of crossing the gridline. Neither
                       * the h3 nor its section may gain `overflow` or
                       * `transform` — either silently breaks both stickies.
                       *
                       * The drag tint is a gradient, not `bg-primary/5`: a
                       * background-color would replace `bg-background` in
                       * tailwind-merge and turn the band translucent mid-drag
                       * — and a collapsed section is nothing *but* this band,
                       * so it has to carry the drop feedback itself.
                       */}
                      <h3
                        className={cn(
                          // `group` lets the lightning of a section with no
                          // rules wait for a hover — see SectionAutomationPopover.
                          'group sticky top-[var(--list-header-h,30px)] z-20 bg-background px-2 py-1.5',
                          isOver && 'bg-gradient-to-r from-primary/5 to-primary/5',
                        )}
                      >
                        <span
                          className="sticky left-2 flex w-fit items-center gap-1.5"
                          style={{ maxWidth: (shown[0] ? columnWidth(shown[0]) : 300) - 16 }}
                        >
                          <SectionHeader
                            group={group}
                            projectId={projectId}
                            collapsed={collapsed.has(group.id)}
                            canEdit={canEdit}
                            selected={selectedSectionId === group.id}
                            onSelect={onSelectSection ? () => onSelectSection(group.id) : undefined}
                            onToggle={() => toggle(group.id)}
                            onRename={(name) => renameSection.mutate({ sectionId: group.id, name })}
                          />
                        </span>
                      </h3>

                      {!collapsed.has(group.id) && (
                        <table className="w-full table-fixed border-t border-border text-sm">
                          <ColumnWidths columns={shown} />
                          <tbody>
                            {group.tasks.map((task) => (
                              <TaskRows
                                key={task.id}
                                task={task}
                                selected={selected.has(task.id)}
                                onSelect={canEdit ? selectRow : undefined}
                                workspaceId={workspaceId}
                                projectId={projectId}
                                columns={shown}
                                metadata={metadata}
                                canEdit={canEdit}
                                pinned={{ ...pinned, scrolled }}
                                manualOrder={manualOrder}
                                onOpenTask={onOpenTask}
                                /*
                                 * Through the shared mutation, whatever the row
                                 * is. Sending every edit to the task endpoint
                                 * meant a ticket's inline changes hit
                                 * `PATCH /tasks/:id` with a ticket id and 404'd
                                 * — the cell reverted and the grid looked as
                                 * though nothing had been typed.
                                 */
                                onSaveTask={(workItemId, payload) =>
                                  updateWorkItem.mutate({
                                    workItemId,
                                    payload: toWorkItemUpdate(payload),
                                  })
                                }
                                onSaveField={(taskId, fieldId, value) =>
                                  setFieldValue.mutate({ taskId, fieldId, value })
                                }
                                onAddSubtask={(parentId, title) =>
                                  create({ type: 'TASK', title, parentId, sectionId: group.id })
                                }
                              />
                            ))}

                            {/*
                        The add row lives inside the table so it lines up with
                        the rows above it, and spans every column because it is
                        one field rather than a row of cells. Held to the title
                        column's width all the same — the open input is flat,
                        so without the cap typed text would run straight across
                        the column rules. The orphan bucket is excluded: it is
                        not a section, so nothing can be filed into it.
                      */}
                            {group.id !== ORPHAN_GROUP_ID && (
                              <tr className="border-b border-border">
                                <td colSpan={shown.length + 2} className="p-0">
                                  <div
                                    className="sticky left-0"
                                    style={{ width: shown[0] ? columnWidth(shown[0]) : 320 }}
                                  >
                                    <QuickCreateWorkItemRow
                                      ref={
                                        group.id === (firstSectionId ?? groups[0]?.id)
                                          ? firstRowRef
                                          : undefined
                                      }
                                      defaultType={defaultType}
                                      sectionName={group.name}
                                      pending={createWorkItem.isPending}
                                      plain
                                      className="pl-10"
                                      onCreate={async ({ type, title }) => {
                                        // Under a value heading the row is filed
                                        // in the first section, then given the
                                        // heading's value — so it lands where it
                                        // was typed.
                                        if (group.kind === 'section') {
                                          await create({ type, title, sectionId: group.id });
                                          return;
                                        }
                                        const created = await create({
                                          type,
                                          title,
                                          ...(firstSectionId ? { sectionId: firstSectionId } : {}),
                                        });
                                        applyGroupValue(group, toWorkItemRow(created));
                                      }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </section>
                  )}
                </SectionDropZone>
              ))}

              {/* Asana closes the list with "+ Add section"; same dialog the
                  create button's menu opens. */}
              {canEdit && (
                <div className="sticky left-0 w-fit">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setAddingSection(true)}
                  >
                    <Plus />
                    Add section
                  </Button>
                </div>
              )}

              {/* The full-height column rules. Behind the rows (negative z),
                  so opaque things — the sticky header, pinned cells — cover
                  them and draw their own. `!mt-0` keeps the absolutely
                  positioned box out of the space-y rhythm. */}
              <div
                ref={linesRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 !mt-0"
              >
                {columnEdges.map((edge) => (
                  <span
                    key={edge}
                    className="absolute inset-y-0 w-px bg-border/60"
                    style={{ left: edge - 1 }}
                  />
                ))}
              </div>

              {/* The rules are also handles: grab one anywhere along its
                  height to resize the column, as in Asana. A pinned column's
                  visible edge parts company with its natural position once
                  the grid is scrolled, so its strip retires and the header
                  handle takes over. */}
              {canEdit && (
                <div ref={stripsRef} className="pointer-events-none absolute inset-0 z-20 !mt-0">
                  {shown.map((column, index) => {
                    if (pinned.offsets.has(column.field) && scrolled) return null;
                    return (
                      <EdgeResizer
                        key={column.field}
                        x={columnEdges[index] ?? 0}
                        label={`Resize ${columnLabel(column.field, metadata)}`}
                        onDrag={(dx) => setResizing(resizeAdjustments(index, dx))}
                        onEnd={(dx) => {
                          const adjustments = resizeAdjustments(index, dx);
                          setResizing(null);
                          if (adjustments) commitResize(adjustments);
                        }}
                        onCancel={() => setResizing(null)}
                      />
                    );
                  })}

                  {/* Asana's blue guide, tracking whichever edge is being
                      dragged — the header handles share it too. */}
                  {resizeEdge !== null && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 w-0.5 bg-primary/70"
                      style={{ left: resizeEdge - 1 }}
                    />
                  )}
                </div>
              )}
            </div>
          </ListDndContext>
        </div>
      )}

      {/*
        One dialog for the view rather than one per section: it is keyed by what
        it opens from, so reopening it for a different section builds a fresh
        form instead of carrying the last one's answers across.
      */}
      {/* Asana's selection bar, the moment anything is selected. */}
      {canEdit && selectedRows.length > 0 && (
        <BulkActionBar
          ref={bulkBarRef}
          count={selectedRows.length}
          members={metadata?.members ?? []}
          sections={metadata?.sections ?? []}
          hasTicket={selectedRows.some(isTicketRow)}
          taskCount={selectedRows.filter((row) => !isTicketRow(row)).length}
          fields={metadata?.customFields ?? []}
          metadata={metadata}
          canArchive={canArchive}
          pending={bulk.isPending}
          onAssign={(assigneeId) =>
            runBulk({ update: toWorkItemUpdate({ assigneeId }) }, 'Assigned')
          }
          onSchedule={(changes) => runBulk({ update: toWorkItemUpdate(changes) }, 'Rescheduled')}
          onStatus={(status) => runBulk({ update: toWorkItemUpdate({ status }) }, 'Updated')}
          onPriority={(priority) => runBulk({ update: toWorkItemUpdate({ priority }) }, 'Updated')}
          onMove={(sectionId) => runBulk({ sectionId }, 'Moved')}
          onFieldValue={(field, payload) =>
            runBulk(
              { update: { customFieldValues: { [field.id]: payload } } },
              `Set ${field.name} on`,
            )
          }
          onArchive={() => runBulk({ archived: true }, 'Archived')}
          onClear={clearSelection}
        />
      )}

      <CreateSectionDialog
        open={addingSection}
        onOpenChange={setAddingSection}
        metadata={metadata}
        pending={createSection.isPending}
        onSubmit={(payload) => createSection.mutateAsync(payload)}
      />

      <CreateWorkItemDialog
        open={composing !== null}
        onOpenChange={(next) => !next && setComposing(null)}
        initialType={composing?.type ?? defaultType}
        initialSectionId={composing?.sectionId}
        metadata={metadata}
        pending={createWorkItem.isPending}
        onSubmit={(payload) => createWorkItem.mutateAsync(payload)}
      />

      {/* Keyed by mounting: it exists only while a field is being edited, so
          its form state initialises from that field and no other. */}
      {editingField && (
        <EditCustomFieldDialog
          workspaceId={workspaceId}
          projectId={projectId}
          field={editingField}
          onOpenChange={(open) => !open && setEditingFieldId(null)}
        />
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
  /** False while a sort or a value grouping owns the order: no drag handle. */
  manualOrder?: boolean;
  onOpenTask: (taskId: string) => void;
  onSaveTask: (taskId: string, payload: Record<string, unknown>) => void;
  onSaveField: (taskId: string, fieldId: string, value: Record<string, unknown>) => void;
  /** Absent when the caller cannot create — the row then offers nothing. */
  onAddSubtask?: ((parentId: string, title: string) => Promise<unknown>) | undefined;
  /** Absent when rows cannot be selected — a read-only view. Top-level rows only. */
  onSelect?: ((id: string, modifiers: { shift: boolean; toggle: boolean }) => void) | undefined;
}

/**
 * One task, and its subtasks once somebody asks for them.
 *
 * A component per row rather than rows built in a loop, because the expand
 * state and the fetch it triggers belong to the row that owns them. Nesting is
 * one level deep, so a subtask renders as a plain row: no recursion, and no
 * expander on a row that can never have children.
 */
// `onAddSubtask` is pulled out rather than left in `shared`: the row below is a
// plain `<tr>` and has no use for it, and spreading it there would hand a child
// row a handler for creating children of its own.
function TaskRows({
  task,
  onAddSubtask,
  selected,
  ...shared
}: RowProps & { task: TaskRow; selected: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const {
    data: subtasks,
    isLoading,
    isError,
  } = useSubtasks(shared.workspaceId, shared.projectId, task.id, expanded);

  return (
    <>
      <Row
        {...shared}
        task={task}
        selected={selected}
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

      {/*
        A subtask is always a TASK, whatever the project defaults to and
        whatever the parent is. Tickets have no hierarchy — the API refuses one
        as a child — so offering the choice here would offer something that
        cannot happen.
      */}
      {expanded && !isLoading && onAddSubtask && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={shared.columns.length + 2} className="p-0">
            <div
              className="sticky left-0 pl-8"
              style={{ width: shared.columns[0] ? columnWidth(shared.columns[0]) : 320 }}
            >
              <QuickCreateWorkItemRow
                defaultType="TASK"
                sectionName={task.title}
                plain
                onCreate={({ title }) => onAddSubtask(task.id, title)}
              />
            </div>
          </td>
        </tr>
      )}
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
  onSelect,
  selected = false,
  manualOrder = true,
}: RowProps & {
  task: TaskRow;
  depth?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  selected?: boolean;
}) {
  const drop = useRowDropTarget(task.id);

  // Subtasks belong to their parent and sit out of multi-select, as they sit
  // out of dragging: a bulk move would quietly promote one.
  const selectable = depth === 0 && canEdit && onSelect !== undefined;
  const isSelected = selectable && selected;

  return (
    <tr
      ref={depth === 0 ? drop.ref : undefined}
      aria-selected={selectable ? isSelected : undefined}
      // A click on the row's own padding selects; one on a control is that
      // control's. Shift extends from the anchor, ctrl/cmd adds or removes.
      onClick={
        selectable
          ? (event) => {
              if (isInteractiveTarget(event.target)) return;
              onSelect(task.id, { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
            }
          : undefined
      }
      // Shift-click would otherwise select the text between the two rows.
      onMouseDown={
        selectable
          ? (event) => {
              if (event.shiftKey) event.preventDefault();
            }
          : undefined
      }
      className={cn(
        'group border-b border-border last:border-0 hover:bg-muted/30',
        isSelected && [SELECTED_BG, SELECTED_BG_HOVER],
        // A line where the row would land, rather than a filled highlight that
        // hides the row it is about to sit beside.
        drop.isOver && depth === 0 && 'shadow-[inset_0_2px_0_0_var(--color-primary)]',
      )}
    >
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
              // The column rules are drawn once behind the whole list; a
              // pinned cell is opaque and covers them, so it carries its own.
              left !== undefined && 'sticky z-10 border-r border-border/60 bg-background',
              left !== undefined && isSelected && SELECTED_BG,
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
              // Only top-level rows drag: a subtask belongs to its parent, and
              // moving one into a section would quietly promote it.
              draggable={canEdit && manualOrder && depth === 0}
              depth={depth}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onOpen={() => onOpenTask(task.id)}
              onSaveTask={(payload) => onSaveTask(task.id, payload)}
              onSaveField={(fieldId, value) => onSaveField(task.id, fieldId, value)}
              selected={isSelected}
              onToggleSelect={
                selectable ? () => onSelect(task.id, { shift: false, toggle: true }) : undefined
              }
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
  projectId,
  collapsed,
  canEdit,
  selected,
  onSelect,
  onToggle,
  onRename,
}: {
  group: RowGroup;
  projectId: string;
  collapsed: boolean;
  canEdit: boolean;
  selected: boolean;
  onSelect: (() => void) | undefined;
  onToggle: () => void;
  onRename: (name: string) => void;
}) {
  // A value heading — a status, an assignee, an option — has no name to
  // rename and no section for a rule to belong to.
  const isRealSection = group.kind === 'section' && group.id !== ORPHAN_GROUP_ID;
  // Only a real section has an id worth putting in the address bar.
  const select = isRealSection ? onSelect : undefined;

  const editor = useCellEditor(group.name, (name) => {
    const trimmed = name.trim();
    // A nameless section cannot be told apart from its neighbours, so an empty
    // name reverts rather than saving.
    if (trimmed) onRename(trimmed);
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editor.editing) inputRef.current?.select();
  }, [editor.editing]);

  // A link that names this section lands on it, the way `?task=` opens the
  // panel. Once, on arrival: a click that selects it must not scroll anything,
  // so the first render's answer is the one that counts.
  const [landedHere] = useState(selected);
  useEffect(() => {
    if (!landedHere) return;
    caretRef.current?.closest('section')?.scrollIntoView?.({ block: 'center' });
  }, [landedHere]);

  return (
    <>
      <button
        ref={caretRef}
        type="button"
        onClick={() => {
          onToggle();
          select?.();
        }}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.name}`}
        className="shrink-0 cursor-pointer rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
          onClick={() => {
            editor.open();
            select?.();
          }}
          aria-label={`Rename ${group.name}`}
          className={cn(
            'min-w-0 cursor-pointer truncate rounded px-1 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            selected && 'text-primary',
          )}
        >
          {group.name}
        </button>
      ) : isRealSection ? (
        // Read-only members still get to select it: the id is not an edit.
        <button
          type="button"
          onClick={() => select?.()}
          aria-label={`Select ${group.name}`}
          className={cn(
            'min-w-0 cursor-pointer truncate rounded px-1 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            selected && 'text-primary',
          )}
        >
          {group.name}
        </button>
      ) : group.kind === 'value' && group.color ? (
        // The value's own chip, so a status heading looks like the status
        // chip in the rows beneath it.
        <span className="min-w-0 px-1">
          <SemanticBadge color={group.color}>{group.name}</SemanticBadge>
        </span>
      ) : (
        <span className="min-w-0 truncate px-1 text-sm font-semibold text-foreground">
          {group.name}
        </span>
      )}

      {/*
        What runs when something lands in this section — the same control the
        Board column header carries. After the name, where Asana keeps its
        lightning. Not on the orphan bucket: that is a synthetic group for
        items whose section was removed, and there is no section for a rule to
        belong to.
      */}
      {isRealSection && (
        <SectionAutomationPopover
          projectId={projectId}
          sectionId={group.id}
          sectionName={group.name}
        />
      )}

      {/* Asana's section "…": here it carries the link and the id, which is
          where somebody wiring a tool goes looking for them. Shown on hover,
          like the lightning beside it. */}
      {isRealSection && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Section options for ${group.name}`}
              className="shrink-0 cursor-pointer rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <SectionLinkItems projectId={projectId} sectionId={group.id} view="list" />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* The count only earns its place once the rows are hidden — open,
          the rows speak for themselves, as in Asana. */}
      {collapsed && (
        <span className="rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground">
          {group.tasks.length}
        </span>
      )}
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
 * A full-height grab strip over one column rule — pointer capture, stretched
 * down the pane so the line itself is what you grab, the way Asana's rules
 * drag. It only reports how far the pointer travelled; what that does to the
 * columns is the caller's decision.
 */
function EdgeResizer({
  x,
  label,
  onDrag,
  onEnd,
  onCancel,
}: {
  x: number;
  label: string;
  onDrag: (dx: number) => void;
  onEnd: (dx: number) => void;
  onCancel: () => void;
}) {
  const start = useRef<number | null>(null);

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        start.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (start.current !== null) onDrag(event.clientX - start.current);
      }}
      onPointerUp={(event) => {
        if (start.current === null) return;
        const dx = event.clientX - start.current;
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onEnd(dx);
      }}
      onPointerCancel={() => {
        start.current = null;
        onCancel();
      }}
      className="pointer-events-auto absolute inset-y-0 w-[7px] -translate-x-1/2 cursor-col-resize touch-none hover:bg-primary/20"
      style={{ left: x }}
    />
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
  draggable,
  depth,
  expanded,
  onToggleExpand,
  onOpen,
  onSaveTask,
  onSaveField,
  selected,
  onToggleSelect,
}: {
  task: TaskRow;
  field: string;
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  draggable?: boolean;
  depth?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onOpen: () => void;
  onSaveTask: (payload: Record<string, unknown>) => void;
  onSaveField: (fieldId: string, payload: Record<string, unknown>) => void;
  selected?: boolean;
  onToggleSelect?: (() => void) | undefined;
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
          dragHandle={draggable ? <RowDragHandle taskId={task.id} title={task.title} /> : undefined}
          selected={selected}
          onToggleSelect={onToggleSelect}
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
      return <StartDateCell {...shared} />;
    case SystemField.COMPLETED_AT:
      return (
        <span className="text-xs">
          {task.completedAt ? formatDate(task.completedAt) : <EmptyCell />}
        </span>
      );
    case SystemField.CREATED_AT:
      return <span className="text-xs">{formatDate(task.createdAt)}</span>;
    case SystemField.ESTIMATE:
      return (
        <span className="text-xs tabular-nums">
          {task.estimatedMinutes ? `${task.estimatedMinutes}m` : <EmptyCell />}
        </span>
      );

    default: {
      const fieldId = field.startsWith('custom:') ? field.slice('custom:'.length) : null;
      const definition = fieldId
        ? metadata?.customFields.find((entry) => entry.id === fieldId)
        : undefined;

      // A column whose field was archived or removed. Blank rather than a
      // thrown render — a missing cell is recoverable, a broken row is not.
      if (!definition) return <EmptyCell />;

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
