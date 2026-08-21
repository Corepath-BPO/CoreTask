import { TaskStatus, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ProjectFieldMetadata, Task, TaskCustomFieldValue, TaskDetail } from '@coretask/types';
import {
  Archive,
  ArchiveRestore,
  ArrowRightToLine,
  Calendar,
  CircleCheck,
  CircleUserRound,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  ListChecks,
  ListPlus,
  Loader2,
  Maximize2,
  Plus,
  Repeat2,
  ThumbsUp,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel';
import { CommentThread } from '@/features/comments/components/comment-thread';
import { CustomFieldCell } from '@/features/projects/components/cells/custom-field-cell';
import { useCellEditor } from '@/features/projects/components/cells/use-cell-editor';
import { FieldTypeIcon } from '@/features/projects/components/field-picker/field-type-icon';
import {
  useFieldMetadata,
  useSetCustomFieldValue,
  useSubtasks,
} from '@/features/projects/hooks/use-project-views';
import { useProject } from '@/features/projects/hooks/use-projects';
import {
  useMoveProjectWorkItem,
  useProjectWorkItem,
  useUpdateProjectWorkItem,
} from '@/features/work-items/hooks/use-project-work-items';
import { toWorkItemUpdate } from '@/features/work-items/lib/cell-payload';
import { isTicketRow, toWorkItemRow } from '@/features/work-items/lib/work-item-row';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { usePanelFocus } from '@/lib/hooks/use-panel-focus';
import { textWidth } from '@/lib/text-width';
import { cn, daysUntil, formatDate, formatDueDate, percentage } from '@/lib/utils';

import {
  useArchiveTask,
  useCreateTask,
  useMoveTaskToSection,
  useTaskDetail,
  useUpdateTask,
} from '../hooks/use-tasks';

const UNASSIGNED = '__unassigned__';
const NO_SECTION = '__none__';

interface TaskDetailDialogProps {
  workspaceId: string | undefined;
  taskId: string | null;
  onClose: () => void;
  role: WorkspaceRole;
}

/**
 * Task detail, edited in place.
 *
 * Fields save on blur or on change rather than behind a Save button: a task
 * panel is a place you poke at one field at a time, and a modal form would make
 * every tweak a two-step transaction.
 */
export function TaskDetailDialog({ workspaceId, taskId, onClose, role }: TaskDetailDialogProps) {
  const { data: task, isLoading } = useTaskDetail(workspaceId, taskId);

  if (!taskId) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {/* The accessible name lives on the dialog chrome, so the body can be
            reused where there is no dialog — see TaskDetailPanel. */}
        <DialogTitle className="sr-only">{task?.title ?? 'Task details'}</DialogTitle>
        <DialogDescription className="sr-only">
          Edit this task's fields and subtasks.
        </DialogDescription>

        {isLoading || !task ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading task</span>
          </div>
        ) : (
          /*
           * Keyed by task id so opening a different task remounts with fresh
           * field state. That replaces an effect that copied props into state —
           * and it also means a background refetch of the *same* task cannot
           * overwrite what the user is currently typing.
           */
          <TaskDetailBody
            key={task.id}
            task={task}
            workspaceId={workspaceId}
            role={role}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same task detail slid in from the right edge instead of opened over the
 * page — the panel the portfolio pages established: flush with the window,
 * internally scrollable, and the list stays visible and usable behind it.
 */
export function TaskDetailPanel({
  workspaceId,
  taskId,
  onClose,
  role,
  projectId,
  onOpenTask,
}: TaskDetailDialogProps & {
  /** Known by the project pages; what lets the panel serve tickets too. */
  projectId?: string | undefined;
  /** Swaps the panel to another task — how a subtask opens from the menu. */
  onOpenTask?: ((taskId: string) => void) | undefined;
}) {
  const open = taskId !== null;

  /*
   * The last task shown, kept through the slide-out so the panel does not
   * empty mid-animation — the same render-adjust pattern as the portfolio
   * project panel.
   */
  const [lastId, setLastId] = useState<string | null>(null);
  if (taskId !== null && taskId !== lastId) setLastId(taskId);
  const shownId = taskId ?? lastId;

  /*
   * Two sources, one shape. The tasks endpoint refuses a ticket id outright,
   * so when it errors and the project is known, the shared work-item endpoint
   * answers instead — it serves both kinds. The subtasks come from the same
   * query the List's expander uses.
   */
  const taskQuery = useTaskDetail(workspaceId, shownId);
  const wantFallback = Boolean(taskQuery.isError && projectId && shownId);
  // Fetched alongside, not only as the fallback: this is where the custom
  // field values live, for tasks and tickets alike.
  const workItemQuery = useProjectWorkItem(
    workspaceId,
    projectId && shownId ? projectId : '',
    projectId ? shownId : null,
  );
  const { data: fallbackSubtasks } = useSubtasks(
    workspaceId,
    projectId ?? '',
    shownId ?? '',
    wantFallback && Boolean(workItemQuery.data),
  );

  /* The project's field definitions and the value writer — the same pair the
     List's cells use, so a value edited here lands the same way. */
  const { data: metadata } = useFieldMetadata(projectId ? workspaceId : undefined, projectId ?? '');
  const setFieldValue = useSetCustomFieldValue(workspaceId, projectId ?? '');

  const workItemRow = workItemQuery.data ? toWorkItemRow(workItemQuery.data) : null;

  const task: TaskDetail | undefined =
    taskQuery.data ??
    (workItemRow
      ? {
          ...workItemRow,
          subtasks: (fallbackSubtasks ?? []) as Task[],
          project: null,
          section: null,
          createdBy: null,
        }
      : undefined);
  const isLoading = taskQuery.isLoading || (wantFallback && workItemQuery.isLoading);

  // The dialog's Escape, kept: the panel is not modal, but the key should
  // still put it away.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // An Escape a Select or cell editor already answered was aimed at the
      // control, not the panel.
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const asideRef = useRef<HTMLElement>(null);
  usePanelFocus(asideRef, open);

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const updateTask = useUpdateTask(workspaceId);
  const completed = Boolean(task && !isTicketRow(task) && task.status === TaskStatus.DONE);

  /*
   * The toolbar's edge only draws once something has scrolled behind it —
   * a permanent line reads as a seam, one that appears says "there is more
   * up here". Same signal the List's frozen column uses.
   */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // A new task reads from the top; the scroller outlives the keyed body. No
  // `setScrolled(false)` here — when this actually moves the pane, the scroll
  // event it fires resets the edge through the onScroll handler.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [shownId]);

  const copyLink = () => {
    // The open task lives in the URL — see the project pages — so the address
    // bar is the deep link.
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast.success('Task link copied'),
      () => toast.error('Could not copy the link'),
    );
  };

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Task details"
      inert={!open}
      className={cn(
        // `m-0` is load-bearing: this renders inside a page that stacks its
        // children with `space-y-*`, and Tailwind v4 hands every non-last child
        // a `margin-block-end`. On an element pinned to both `inset-y` edges a
        // bottom margin does not offset it, it *shortens* it, which left a gap
        // between the panel and the bottom of the window.
        'fixed inset-y-0 right-0 z-40 m-0 flex w-full max-w-[42rem] flex-col border-l bg-card shadow-xl outline-none transition-transform',
        // Decelerate into place; leave quicker than arriving. The global
        // reduced-motion kill-switch already flattens these transitions.
        open ? 'translate-x-0 duration-300 ease-out' : 'translate-x-full duration-200 ease-in',
      )}
    >
      {/* Asana's pane top bar: the type chip and Mark complete on the left,
          the icon tail on the right. Like and expand are honestly inert until
          they have something real to do. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b px-3 py-2 transition-[border-color,box-shadow]',
          scrolled ? 'shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'border-transparent',
        )}
      >
        {task && (
          <Badge variant="outline" className="text-xs">
            {isTicketRow(task) ? 'Ticket' : 'Task'}
          </Badge>
        )}
        {/* The circle from the List rows, promoted to words. Tickets sit this
            out — "complete" is a different word in their vocabulary. */}
        {task && !isTicketRow(task) && (
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || updateTask.isPending}
            aria-pressed={completed}
            onClick={() =>
              updateTask.mutate({
                taskId: task.id,
                payload: { status: completed ? TaskStatus.TODO : TaskStatus.DONE },
              })
            }
            className={cn(completed && 'border-success/40 text-success hover:text-success')}
          >
            <CircleCheck />
            {completed ? 'Completed' : 'Mark complete'}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            title="Likes are not built yet"
            aria-label="Like (not built yet)"
          >
            <ThumbsUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy link to this task"
            onClick={copyLink}
          >
            <Link2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            title="The full-screen view is not built yet"
            aria-label="Expand (not built yet)"
          >
            <Maximize2 />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close task details" onClick={onClose}>
            <ArrowRightToLine />
          </Button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {task ? (
          <div className="grid gap-4 px-6 py-5">
            <TaskDetailBody
              key={task.id}
              task={task}
              workspaceId={workspaceId}
              role={role}
              onClose={onClose}
              onOpenTask={onOpenTask}
              metadata={metadata}
              customFieldValues={workItemRow?.customFieldValues}
              onSaveField={(fieldId, value) =>
                setFieldValue.mutate(
                  { taskId: task.id, fieldId, value },
                  {
                    /* The hook refreshes the List's query; the panel reads the
                       work item, which needs its own nudge. */
                    onSuccess: () => {
                      if (projectId) {
                        void queryClient.invalidateQueries({
                          queryKey: queryKeys.workItems.all(workspaceId as string, projectId),
                        });
                      }
                    },
                  },
                )
              }
            />
          </div>
        ) : !shownId ? null : isLoading ? (
          <TaskPanelSkeleton />
        ) : (
          <div className="grid justify-items-start gap-3 px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Could not load this item. It may have been deleted, or the link may be wrong.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void taskQuery.refetch();
                  if (projectId) void workItemQuery.refetch();
                }}
              >
                Retry
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The panel's regions as grey boxes, in the body's own metrics — chips and
 * title, the field rows on their 110px gutter, description, subtasks — so the
 * real content lands where the boxes were. See TicketDetailSkeleton.
 */
function TaskPanelSkeleton() {
  return (
    <div role="status" aria-live="polite" className="grid gap-4 px-6 py-5">
      <span className="sr-only">Loading task</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-3/4" />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="grid grid-cols-[110px_1fr] items-center gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-44" />
          </div>
        ))}
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    </div>
  );
}

interface TaskDetailBodyProps {
  task: TaskDetail;
  workspaceId: string | undefined;
  role: WorkspaceRole;
  onClose: () => void;
  onOpenTask?: ((taskId: string) => void) | undefined;
  /** The project's field definitions; absent where no project is known. */
  metadata?: ProjectFieldMetadata | undefined;
  /** This item's stored values, straight off the work-item record. */
  customFieldValues?: TaskCustomFieldValue[] | undefined;
  onSaveField?: ((fieldId: string, value: Record<string, unknown>) => void) | undefined;
}

function TaskDetailBody({
  task,
  workspaceId,
  role,
  onClose,
  onOpenTask,
  metadata,
  customFieldValues,
  onSaveField,
}: TaskDetailBodyProps) {
  const { data: members } = useWorkspaceMembers(workspaceId);
  // Already cached by the board in the common case, so this is usually free.
  const { data: project } = useProject(workspaceId, task.projectId ?? '');
  const updateTask = useUpdateTask(workspaceId);
  const archiveTask = useArchiveTask(workspaceId);
  const createTask = useCreateTask(workspaceId);
  const moveTask = useMoveTaskToSection(workspaceId);
  // The ticket routes: a ticket's edits 404 on the task endpoints.
  const updateWorkItem = useUpdateProjectWorkItem(workspaceId, task.projectId ?? '');
  const moveWorkItem = useMoveProjectWorkItem(workspaceId, task.projectId ?? '');

  const sections = project?.sections ?? [];

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canArchive = hasAtLeastRole(role, WorkspaceRole.MANAGER);
  const ticket = isTicketRow(task);

  /* The project chip: the task endpoint embeds it; the work-item fallback
     does not, but the project query already has everything the chip shows. */
  const projectRef =
    task.project ??
    (project
      ? { id: project.id, name: project.name, key: project.key, color: project.color }
      : null);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  /** Where a right-click landed, and on which subtask — Asana's row menu. */
  const [menu, setMenu] = useState<{ x: number; y: number; subtask: Task } | null>(null);

  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  const save = (payload: Parameters<typeof updateTask.mutate>[0]['payload']) => {
    if (!canEdit) return;
    if (ticket) {
      updateWorkItem.mutate({
        workItemId: task.id,
        payload: toWorkItemUpdate(payload as Record<string, unknown>),
      });
    } else {
      updateTask.mutate({ taskId: task.id, payload });
    }
  };

  const addSubtask = () => {
    const trimmed = subtaskTitle.trim();
    if (!trimmed) return;
    createTask.mutate({ title: trimmed, parentTaskId: task.id });
    setSubtaskTitle('');
  };

  const subtaskProgress = percentage(task.completedSubtaskCount, task.subtaskCount);

  const taskDone = !ticket && task.status === TaskStatus.DONE;

  /*
   * Display-first, as the List's due-date cell reads: the resting state is
   * "Tomorrow" in the app's own words, and the date input only exists while
   * editing. The always-on input it replaces was uncontrolled and saved on
   * every change — each arrow press in the segmented control fired a mutation.
   */
  const dueEditor = useCellEditor(task.dueDate?.slice(0, 10) ?? '', (value) =>
    save({ dueDate: value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null }),
  );
  const dueDays = task.dueDate && !taskDone ? daysUntil(task.dueDate) : null;

  /*
   * The field-group gutter, sized to the longest field name — measured in the
   * label's own font and clamped, so "Did we place the Tenant?" reads whole
   * but one epic name cannot push every value off the pane. 30px covers the
   * type icon, its gap, and a little slack.
   */
  const fieldLabelWidth = useMemo(() => {
    const widest = (metadata?.customFields ?? []).reduce(
      (max, field) => Math.max(max, textWidth(field.name, '400 12px')),
      0,
    );
    return Math.min(240, Math.max(150, Math.ceil(widest) + 30));
  }, [metadata]);

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 pr-8">
          {projectRef && (
            <>
              <span
                aria-hidden="true"
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: projectRef.color }}
              />
              <Badge variant="outline" className="font-mono text-[10px]">
                {projectRef.key}
              </Badge>
            </>
          )}
          {task.section && <Badge variant="muted">{task.section.name}</Badge>}
          {task.archivedAt && <Badge variant="destructive">Archived</Badge>}
        </div>

        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
          disabled={!canEdit}
          aria-label="Task title"
          placeholder="Write a task name"
          className="mt-1 h-auto border-0 px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
        />
      </header>

      {/* Asana's field rows: the label on the left, the value beside it. */}
      <div className="space-y-0.5">
        <FieldRow label="Assignee">
          <Select
            value={task.assigneeId ?? UNASSIGNED}
            onValueChange={(value) => save({ assigneeId: value === UNASSIGNED ? null : value })}
            disabled={!canEdit}
          >
            <SelectTrigger
              aria-label="Assignee"
              className="h-8 w-fit min-w-44 border-0 bg-transparent px-2 shadow-none hover:bg-muted"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CircleUserRound className="size-4" aria-hidden="true" />
                  No assignee
                </span>
              </SelectItem>
              {(members ?? []).map((member) => (
                <SelectItem key={member.user.id} value={member.user.id}>
                  <span className="flex items-center gap-2">
                    <PersonAvatar
                      name={member.user.name}
                      avatarUrl={member.user.avatarUrl}
                      className="size-5"
                      fallbackClassName="text-[9px]"
                    />
                    {member.user.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Due date">
          {dueEditor.editing ? (
            <Input
              type="date"
              autoFocus
              value={dueEditor.draft}
              onChange={(event) => dueEditor.setDraft(event.target.value)}
              onBlur={dueEditor.commit}
              onKeyDown={dueEditor.onKeyDown}
              aria-label="Due date"
              className="h-8 w-fit px-2 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={dueEditor.open}
              disabled={!canEdit}
              aria-label="Due date"
              className={cn(
                'h-8 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                canEdit && 'cursor-pointer',
                !task.dueDate && 'text-muted-foreground',
                dueDays !== null && dueDays < 0 && 'text-destructive',
                (dueDays === 0 || dueDays === 1) && 'text-success',
              )}
            >
              {/* A finished task is never "3d overdue" — show the plain date. */}
              {task.dueDate
                ? taskDone
                  ? formatDate(task.dueDate)
                  : formatDueDate(task.dueDate)
                : 'No due date'}
            </button>
          )}
        </FieldRow>

        <FieldRow label="Dependencies">
          {/* Nothing models a dependency yet — present but honest. */}
          <Button
            variant="ghost"
            size="sm"
            disabled
            title="Dependencies are not built yet"
            className="text-muted-foreground"
          >
            Add dependencies
          </Button>
        </FieldRow>

        {projectRef && (
          <FieldRow label="Projects">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-sm">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: projectRef.color }}
                />
                <span className="truncate">{projectRef.name}</span>
              </span>

              {/*
                The keyboard path for moving a task between columns, in the
                spot Asana hangs the section from the project chip. Board
                cards are pointer-drag only, so without this, reordering
                would be a gesture some users simply cannot perform.
              */}
              {sections.length > 0 && (
                <Select
                  value={task.sectionId ?? NO_SECTION}
                  onValueChange={(value) => {
                    if (!canEdit) return;
                    const sectionId = value === NO_SECTION ? null : value;
                    if (ticket) {
                      moveWorkItem.mutate({
                        workItemId: task.id,
                        payload: { targetSectionId: sectionId },
                      });
                    } else {
                      moveTask.mutate({
                        taskId: task.id,
                        payload: { sectionId, afterTaskId: null },
                      });
                    }
                  }}
                  disabled={!canEdit || moveTask.isPending || moveWorkItem.isPending}
                >
                  <SelectTrigger
                    aria-label="Section"
                    className="h-8 w-fit border-0 bg-transparent px-2 text-muted-foreground shadow-none hover:bg-muted"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SECTION}>No section</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </FieldRow>
        )}
      </div>

      {/* Asana's bordered field group. Status and Priority stay editable in
          place; the dates are records of what happened, not settings. */}
      {/* The project's own fields, as Asana lists them in the pane — the
          same definitions and editors the List's columns use, so a value set
          here is the value the grid shows. Nothing hardcoded: no custom
          fields, no box. Status and priority stay the grid's columns. */}
      {(metadata?.customFields.length ?? 0) > 0 && (
        <div className="rounded-md border border-border/60">
          {(metadata?.customFields ?? []).map((field) => (
            <GroupRow
              key={field.id}
              icon={<FieldTypeIcon type={field.type} className="size-3.5" />}
              label={field.name}
              labelWidth={fieldLabelWidth}
            >
              <div className="min-w-0 px-2 text-sm">
                <CustomFieldCell
                  field={field}
                  value={customFieldValues?.find((entry) => entry.customFieldId === field.id)}
                  metadata={metadata}
                  canEdit={canEdit && Boolean(onSaveField)}
                  taskTitle={task.title}
                  onSave={(payload) => onSaveField?.(field.id, payload)}
                />
              </div>
            </GroupRow>
          ))}
        </div>
      )}

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Description</h3>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() =>
            description !== (task.description ?? '') &&
            save({ description: description.trim() || null })
          }
          placeholder={`What is this ${ticket ? 'Ticket' : 'task'} about?`}
          rows={3}
          disabled={!canEdit}
          aria-label="Description"
          className="resize-none border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </section>

      <Separator />

      <section className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ListChecks className="size-3.5" aria-hidden="true" />
            Subtasks
          </h3>
          {task.subtaskCount > 0 && (
            <span
              className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
              title={`${subtaskProgress}% complete`}
            >
              {task.completedSubtaskCount}/{task.subtaskCount}
            </span>
          )}
          {canEdit && !ticket && (
            <button
              type="button"
              onClick={() => setAddingSubtask(true)}
              aria-label="Add a subtask"
              className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <ul>
          {task.subtasks.map((subtask) => {
            const done = subtask.status === TaskStatus.DONE;
            return (
              <li
                key={subtask.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, subtask });
                }}
                // `group`: the row tail's empty-state buttons reveal on hover.
                className="group flex items-center gap-2 border-b border-border/60 px-1 py-1.5 last:border-0"
              >
                {/* Asana's circle check, doing what the checkbox did. */}
                <button
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={done}
                  aria-label={`Mark "${subtask.title}" ${done ? 'incomplete' : 'complete'}`}
                  onClick={() =>
                    updateTask.mutate({
                      taskId: subtask.id,
                      payload: { status: done ? TaskStatus.TODO : TaskStatus.DONE },
                    })
                  }
                  className={cn(
                    'shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    done ? 'text-success' : 'text-muted-foreground hover:text-success',
                  )}
                >
                  <CircleCheck className="size-5" aria-hidden="true" />
                </button>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    done && 'text-muted-foreground line-through decoration-muted-foreground/50',
                  )}
                >
                  {subtask.title}
                </span>
                <SubtaskTail
                  subtask={subtask}
                  canEdit={canEdit}
                  members={members ?? []}
                  onSave={(payload) => updateTask.mutate({ taskId: subtask.id, payload })}
                />
              </li>
            );
          })}
        </ul>

        {/* The API only parents subtasks under tasks — say so rather than
            offering an add that fails. */}
        {ticket && (
          <p className="pt-1 text-xs text-muted-foreground">
            Subtasks under tickets need API support. Not built yet.
          </p>
        )}

        {canEdit &&
          !ticket &&
          (addingSubtask ? (
            <div className="flex items-center gap-2 pt-1">
              <Input
                ref={focusOnMount}
                value={subtaskTitle}
                onChange={(event) => setSubtaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds and stays open, so the next title can follow.
                  if (event.key === 'Enter') addSubtask();
                  if (event.key === 'Escape') {
                    setSubtaskTitle('');
                    setAddingSubtask(false);
                  }
                }}
                onBlur={() => {
                  if (subtaskTitle.trim() === '') setAddingSubtask(false);
                }}
                placeholder="Write a subtask name"
                aria-label="New subtask"
                className="h-8"
              />
              {createTask.isPending && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              )}
            </div>
          ) : (
            /* Asana's closed state: a quiet row that opens into the input. */
            <button
              type="button"
              onClick={() => setAddingSubtask(true)}
              className="cursor-pointer rounded px-1 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              Add subtask
            </button>
          ))}

        {/* Asana's right-click menu, portalled out of the transformed panel
            and anchored where the click landed. */}
        {menu &&
          createPortal(
            <DropdownMenu open onOpenChange={(next) => !next && setMenu(null)}>
              <DropdownMenuTrigger asChild>
                <span aria-hidden="true" style={{ position: 'fixed', left: menu.x, top: menu.y }} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {canEdit && (
                  <DropdownMenuItem
                    onSelect={() =>
                      createTask.mutate({ title: menu.subtask.title, parentTaskId: task.id })
                    }
                  >
                    <Copy />
                    Duplicate subtask
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled title="Follow-up tasks are not built yet">
                  <ListPlus />
                  Create follow-up task
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Converting between types is not built yet">
                  <Repeat2 />
                  Convert to…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {onOpenTask && (
                  <DropdownMenuItem onSelect={() => onOpenTask(menu.subtask.id)}>
                    <Eye />
                    View subtask details
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled title="Subtasks have no page of their own yet">
                  <ExternalLink />
                  Open in new tab
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Subtasks have no link to copy yet">
                  <Link2 />
                  Copy subtask link
                </DropdownMenuItem>
                {canArchive && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        archiveTask.mutate({ taskId: menu.subtask.id, archived: false })
                      }
                    >
                      <Archive />
                      Archive subtask
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>,
            document.body,
          )}
      </section>

      <Separator />

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Created {formatDate(task.createdAt)}
          {task.createdBy ? ` by ${task.createdBy.name}` : ''}
          {task.completedAt ? ` · completed ${formatDueDate(task.completedAt)}` : ''}
        </span>

        {/* Tickets archive through their own endpoints, which this panel does
            not speak yet. */}
        {canArchive && !ticket && (
          <Button
            variant={task.archivedAt ? 'outline' : 'ghost'}
            size="sm"
            className={cn(!task.archivedAt && 'text-destructive hover:text-destructive')}
            loading={archiveTask.isPending}
            onClick={() =>
              archiveTask.mutate(
                { taskId: task.id, archived: task.archivedAt !== null },
                { onSuccess: () => task.archivedAt === null && onClose() },
              )
            }
          >
            {task.archivedAt ? <ArchiveRestore /> : <Archive />}
            {task.archivedAt ? 'Restore' : 'Archive'}
          </Button>
        )}
      </footer>

      <Separator />

      <AttachmentPanel
        workspaceId={workspaceId}
        parent={{ kind: 'task', id: task.id }}
        canManageAny={hasAtLeastRole(role, WorkspaceRole.MANAGER)}
      />

      <Separator />

      <CommentThread workspaceId={workspaceId} parent={{ kind: 'task', id: task.id }} role={role} />
    </>
  );
}

/** Asana's field row: a muted label on the left, the value beside it. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

/**
 * The right edge of a subtask row — Asana's tail: the due date and assignee
 * where they are set, dashed ghost buttons where they are not. The ghosts only
 * surface while the row is hovered or holds focus, so an unscheduled list
 * reads as a list of names rather than a wall of empty controls.
 */
function SubtaskTail({
  subtask,
  canEdit,
  members,
  onSave,
}: {
  subtask: Task;
  canEdit: boolean;
  members: { user: { id: string; name: string; avatarUrl: string | null } }[];
  onSave: (payload: { dueDate: string | null } | { assigneeId: string | null }) => void;
}) {
  const [editingDate, setEditingDate] = useState(false);
  const [pickingAssignee, setPickingAssignee] = useState(false);

  const done = subtask.status === TaskStatus.DONE;
  const days = subtask.dueDate && !done ? daysUntil(subtask.dueDate) : null;

  const commitDate = (value: string) => {
    setEditingDate(false);
    if (value === (subtask.dueDate?.slice(0, 10) ?? '')) return;
    onSave({ dueDate: value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null });
  };

  const ghost =
    'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground opacity-0 transition-opacity hover:border-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover:opacity-100';

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {editingDate ? (
        <Input
          type="date"
          autoFocus
          defaultValue={subtask.dueDate?.slice(0, 10) ?? ''}
          onBlur={(event) => commitDate(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDate(event.currentTarget.value);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              // The panel's own Escape must not fire: cancelling the date is
              // not closing the pane.
              event.stopPropagation();
              setEditingDate(false);
            }
          }}
          aria-label={`Due date for "${subtask.title}"`}
          className="h-6 w-fit px-1 text-xs"
        />
      ) : subtask.dueDate ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setEditingDate(true)}
          aria-label={`Due date for "${subtask.title}"`}
          className={cn(
            'shrink-0 rounded px-1 text-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            canEdit && 'cursor-pointer hover:bg-muted',
            days !== null && days < 0
              ? 'text-destructive'
              : days === 0 || days === 1
                ? 'text-success'
                : 'text-muted-foreground',
          )}
        >
          {done ? formatDate(subtask.dueDate) : formatDueDate(subtask.dueDate)}
        </button>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setEditingDate(true)}
          aria-label={`Set a due date for "${subtask.title}"`}
          className={ghost}
        >
          <Calendar className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}

      {pickingAssignee ? (
        <Select
          open
          value={subtask.assigneeId ?? UNASSIGNED}
          onValueChange={(value) => {
            const next = value === UNASSIGNED ? null : value;
            if (next !== (subtask.assigneeId ?? null)) onSave({ assigneeId: next });
            setPickingAssignee(false);
          }}
          onOpenChange={(next) => !next && setPickingAssignee(false)}
        >
          <SelectTrigger
            aria-label={`Assignee for "${subtask.title}"`}
            className="h-6 w-fit px-1.5 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>
              <span className="flex items-center gap-2 text-muted-foreground">
                <CircleUserRound className="size-4" aria-hidden="true" />
                No assignee
              </span>
            </SelectItem>
            {members.map((member) => (
              <SelectItem key={member.user.id} value={member.user.id}>
                <span className="flex items-center gap-2">
                  <PersonAvatar
                    name={member.user.name}
                    avatarUrl={member.user.avatarUrl}
                    className="size-5"
                    fallbackClassName="text-[9px]"
                  />
                  {member.user.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : subtask.assignee ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setPickingAssignee(true)}
          aria-label={`Assignee for "${subtask.title}": ${subtask.assignee.name}`}
          className={cn(
            'shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            canEdit && 'cursor-pointer',
          )}
        >
          <PersonAvatar
            name={subtask.assignee.name}
            avatarUrl={subtask.assignee.avatarUrl}
            className="size-5"
            fallbackClassName="text-[9px]"
            title={subtask.assignee.name}
          />
        </button>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setPickingAssignee(true)}
          aria-label={`Assign "${subtask.title}"`}
          className={ghost}
        >
          <UserRound className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * One line of the bordered field group — icon, label, value.
 *
 * `group` is load-bearing: the cells' `EmptyCell` placeholder only reveals on
 * `group-hover`, so without it every unset field is an invisible blank strip.
 * The label gutter is measured by the caller — see `fieldLabelWidth` — so a
 * name like "Did we place the Tenant?" reads whole instead of clipping at a
 * width picked before anyone typed it.
 */
function GroupRow({
  icon,
  label,
  labelWidth,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  labelWidth: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
      className="group grid items-center border-b border-border/60 px-3 py-1.5 last:border-0"
    >
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" title={label}>
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}
