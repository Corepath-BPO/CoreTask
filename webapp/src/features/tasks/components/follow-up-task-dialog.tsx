import { TASK_TITLE_MAX_LENGTH } from '@coretask/contracts';
import { useState } from 'react';
import { toast } from 'sonner';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateComment } from '@/features/comments/hooks/use-comments';
import { useFieldMetadata } from '@/features/projects/hooks/use-project-views';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { escapeHtml } from '@/lib/rich-text';

import { useCreateTask } from '../hooks/use-tasks';
import { onlyAssignable } from '../lib/assignable';

/** What a follow-up starts from: the task it follows. */
export interface FollowUpSource {
  id: string;
  title: string;
  projectId: string | null;
  sectionId: string | null;
  assigneeId: string | null;
}

const NOBODY = 'NOBODY';

/** A week from today, as the date input writes it — Asana's default nudge. */
function aWeekFromToday(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Asana's "Create follow-up task": a new task beside this one, named after
 * it and due a week out unless somebody says otherwise. The original gets a
 * comment saying so, so whoever reads it later can find what came next.
 */
export function FollowUpTaskDialog({
  workspaceId,
  source,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string | undefined;
  source: FollowUpSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: ((taskId: string) => void) | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create follow-up task</DialogTitle>
          <DialogDescription>
            A new task beside “{source.title}”. The original is told about it in a comment.
          </DialogDescription>
        </DialogHeader>
        {/* Built fresh on each opening, so it starts from the task as it is now. */}
        {open && (
          <FollowUpForm
            workspaceId={workspaceId}
            source={source}
            onDone={(taskId) => {
              onOpenChange(false);
              if (taskId) onCreated?.(taskId);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FollowUpForm({
  workspaceId,
  source,
  onDone,
}: {
  workspaceId: string | undefined;
  source: FollowUpSource;
  onDone: (taskId: string | null) => void;
}) {
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: metadata } = useFieldMetadata(
    source.projectId ? workspaceId : undefined,
    source.projectId ?? '',
  );
  const createTask = useCreateTask(workspaceId, { announce: false });
  const comment = useCreateComment(workspaceId, { kind: 'task', id: source.id });

  const [title, setTitle] = useState(`Follow up: ${source.title}`.slice(0, TASK_TITLE_MAX_LENGTH));
  const [assigneeId, setAssigneeId] = useState(source.assigneeId ?? NOBODY);
  const [dueDate, setDueDate] = useState(aWeekFromToday());

  const pending = createTask.isPending;
  const ready = title.trim() !== '' && !pending;

  const submit = async () => {
    if (!ready) return;
    try {
      const created = await createTask.mutateAsync({
        title: title.trim(),
        description: `<p>Follow-up to “${escapeHtml(source.title)}”.</p>`,
        projectId: source.projectId,
        sectionId: source.sectionId,
        assigneeId: assigneeId === NOBODY ? null : assigneeId,
        dueDate: dueDate || null,
      });
      comment.mutate({
        body: `<p>Created a follow-up task: “${escapeHtml(created.title)}”.</p>`,
      });
      toast.success('Follow-up task created');
      onDone(created.id);
    } catch {
      // Reported by the create hook; the dialog stays open to retry.
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Task name" htmlFor="follow-up-title">
        <Input
          id="follow-up-title"
          value={title}
          maxLength={TASK_TITLE_MAX_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Assignee" htmlFor="follow-up-assignee">
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger id="follow-up-assignee" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>No assignee</SelectItem>
            {onlyAssignable(
              members,
              source.projectId ? metadata?.assignees : undefined,
              assigneeId === NOBODY ? null : assigneeId,
            ).map((member) => (
              <SelectItem key={member.user.id} value={member.user.id}>
                {member.user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Due date" htmlFor="follow-up-due">
        <Input
          id="follow-up-due"
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Create follow-up
        </Button>
      </DialogFooter>
    </form>
  );
}
