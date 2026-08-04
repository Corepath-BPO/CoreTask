import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskStatus,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { TaskDetail } from '@coretask/types';
import { Archive, ArchiveRestore, ListChecks, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel';
import { CommentThread } from '@/features/comments/components/comment-thread';
import { useProject } from '@/features/projects/hooks/use-projects';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate, formatDueDate, humanizeEnum, initials, percentage } from '@/lib/utils';

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

interface TaskDetailBodyProps {
  task: TaskDetail;
  workspaceId: string | undefined;
  role: WorkspaceRole;
  onClose: () => void;
}

function TaskDetailBody({ task, workspaceId, role, onClose }: TaskDetailBodyProps) {
  const { data: members } = useWorkspaceMembers(workspaceId);
  // Already cached by the board in the common case, so this is usually free.
  const { data: project } = useProject(workspaceId, task.projectId ?? '');
  const updateTask = useUpdateTask(workspaceId);
  const archiveTask = useArchiveTask(workspaceId);
  const createTask = useCreateTask(workspaceId);
  const moveTask = useMoveTaskToSection(workspaceId);

  const sections = project?.sections ?? [];

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const canArchive = hasAtLeastRole(role, WorkspaceRole.MANAGER);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [subtaskTitle, setSubtaskTitle] = useState('');

  const save = (payload: Parameters<typeof updateTask.mutate>[0]['payload']) => {
    if (!canEdit) return;
    updateTask.mutate({ taskId: task.id, payload });
  };

  const subtaskProgress = percentage(task.completedSubtaskCount, task.subtaskCount);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="sr-only">{task.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Edit this task's fields and subtasks.
        </DialogDescription>

        <div className="flex flex-wrap items-center gap-1.5 pr-8">
          {task.project && (
            <>
              <span
                aria-hidden="true"
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: task.project.color }}
              />
              <Badge variant="outline" className="font-mono text-[10px]">
                {task.project.key}
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
          className="mt-1 h-auto border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
        />
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status" htmlFor="task-status">
          <Select
            value={task.status}
            onValueChange={(value) => save({ status: value as TaskDetail['status'] })}
            disabled={!canEdit}
          >
            <SelectTrigger id="task-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {humanizeEnum(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Priority" htmlFor="task-priority">
          <Select
            value={task.priority}
            onValueChange={(value) => save({ priority: value as TaskDetail['priority'] })}
            disabled={!canEdit}
          >
            <SelectTrigger id="task-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {humanizeEnum(priority)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Assignee" htmlFor="task-assignee">
          <Select
            value={task.assigneeId ?? UNASSIGNED}
            onValueChange={(value) => save({ assigneeId: value === UNASSIGNED ? null : value })}
            disabled={!canEdit}
          >
            <SelectTrigger id="task-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {(members ?? []).map((member) => (
                <SelectItem key={member.user.id} value={member.user.id}>
                  {member.user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Due date" htmlFor="task-due">
          <Input
            id="task-due"
            type="date"
            defaultValue={task.dueDate?.slice(0, 10) ?? ''}
            onChange={(event) => save({ dueDate: event.target.value || null })}
            disabled={!canEdit}
          />
        </Field>

        {/*
          The keyboard path for moving a task between columns. Board cards are
          pointer-drag only, so without this, reordering would be a gesture some
          users simply cannot perform.
        */}
        {task.projectId && sections.length > 0 && (
          <Field label="Section" htmlFor="task-section">
            <Select
              value={task.sectionId ?? NO_SECTION}
              onValueChange={(value) =>
                canEdit &&
                moveTask.mutate({
                  taskId: task.id,
                  payload: { sectionId: value === NO_SECTION ? null : value, afterTaskId: null },
                })
              }
              disabled={!canEdit || moveTask.isPending}
            >
              <SelectTrigger id="task-section" className="w-full">
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
          </Field>
        )}
      </div>

      <Field label="Description" htmlFor="task-description">
        <Textarea
          id="task-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() =>
            description !== (task.description ?? '') &&
            save({ description: description.trim() || null })
          }
          placeholder="Add more detail…"
          rows={4}
          disabled={!canEdit}
        />
      </Field>

      <Separator />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ListChecks className="size-3.5" aria-hidden="true" />
            Subtasks
          </h3>
          {task.subtaskCount > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {task.completedSubtaskCount}/{task.subtaskCount} · {subtaskProgress}%
            </span>
          )}
        </div>

        {task.subtasks.length === 0 && (
          <p className="text-xs text-muted-foreground">No subtasks yet.</p>
        )}

        <ul className="space-y-1">
          {task.subtasks.map((subtask) => (
            <li
              key={subtask.id}
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
            >
              <input
                type="checkbox"
                checked={subtask.status === TaskStatus.DONE}
                disabled={!canEdit}
                aria-label={`Mark "${subtask.title}" complete`}
                onChange={(event) =>
                  updateTask.mutate({
                    taskId: subtask.id,
                    payload: {
                      status: event.target.checked ? TaskStatus.DONE : TaskStatus.TODO,
                    },
                  })
                }
                className="size-4 shrink-0 rounded border-input accent-primary"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  subtask.status === TaskStatus.DONE &&
                    'text-muted-foreground line-through decoration-muted-foreground/50',
                )}
              >
                {subtask.title}
              </span>
              {subtask.assignee && (
                <Avatar className="size-5" title={subtask.assignee.name}>
                  {subtask.assignee.avatarUrl && (
                    <AvatarImage src={subtask.assignee.avatarUrl} alt="" />
                  )}
                  <AvatarFallback className="text-[9px]">
                    {initials(subtask.assignee.name)}
                  </AvatarFallback>
                </Avatar>
              )}
            </li>
          ))}
        </ul>

        {canEdit && (
          <div className="flex gap-2">
            <Input
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !subtaskTitle.trim()) return;
                createTask.mutate({ title: subtaskTitle.trim(), parentTaskId: task.id });
                setSubtaskTitle('');
              }}
              placeholder="Add a subtask and press Enter"
              aria-label="New subtask"
              className="h-8"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!subtaskTitle.trim() || createTask.isPending}
              onClick={() => {
                createTask.mutate({ title: subtaskTitle.trim(), parentTaskId: task.id });
                setSubtaskTitle('');
              }}
            >
              <Plus />
              Add
            </Button>
          </div>
        )}
      </section>

      <Separator />

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Created {formatDate(task.createdAt)}
          {task.createdBy ? ` by ${task.createdBy.name}` : ''}
          {task.completedAt ? ` · completed ${formatDueDate(task.completedAt)}` : ''}
        </span>

        {canArchive && (
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
