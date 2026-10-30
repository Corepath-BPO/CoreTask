import type { UserRef } from '@coretask/types';
import { useState } from 'react';
import { toast } from 'sonner';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAssignedCount,
  useReplaceAssignee,
} from '@/features/work-items/hooks/use-project-work-items';

const NOBODY = '__nobody__';

const tasks = (count: number, kind = '') => `${count} ${kind}${count === 1 ? 'task' : 'tasks'}`;

/**
 * Asana's "Find and replace" on the Assignee column: every task in the
 * project assigned to one person, handed to someone else or to nobody.
 *
 * Open tasks unless asked otherwise, so a finished task keeps whoever
 * finished it. The count comes from the server, as does the work, because
 * most of a project is not on screen; the server takes a hundred tasks a
 * request, and the dialog shows how far it has got.
 */
export function ReplaceAssigneeDialog({
  workspaceId,
  projectId,
  people,
  assignees,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  projectId: string;
  /** Whose tasks can be found: anyone in the workspace may hold some. */
  people: UserRef[];
  /** Who they can go to: who a task here may be assigned to. */
  assignees: UserRef[];
  onOpenChange: (open: boolean) => void;
}) {
  const [fromUserId, setFromUserId] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const count = useAssignedCount(workspaceId, projectId, fromUserId, includeCompleted);
  const replace = useReplaceAssignee(workspaceId, projectId);

  const from = people.find((person) => person.id === fromUserId);
  const toName =
    to === NOBODY ? 'nobody' : (assignees.find((person) => person.id === to)?.name ?? null);
  const open = includeCompleted ? '' : 'open ';

  const summary = progress
    ? `Reassigned ${progress.done} of ${tasks(progress.total)}…`
    : !from
      ? 'Choose whose tasks to hand over.'
      : count.isError
        ? `Could not count ${from.name}’s tasks. Try again in a moment.`
        : count.data === undefined
          ? 'Counting…'
          : count.data === 0
            ? `No ${open}tasks here are assigned to ${from.name}.`
            : `${tasks(count.data, open)} assigned to ${from.name}${
                toName ? ` will go to ${toName}` : ''
              }.`;

  const submit = () => {
    if (!fromUserId || !to) return;
    replace.mutate(
      {
        fromUserId,
        toUserId: to === NOBODY ? null : to,
        includeCompleted,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: (done) => {
          toast.success(`Reassigned ${tasks(done)}`);
          onOpenChange(false);
        },
        onSettled: () => setProgress(null),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !replace.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Find and replace assignee</DialogTitle>
          <DialogDescription>
            Hand everything one person is assigned in this project to someone else.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <PersonSelect
            label="Find"
            placeholder="Choose a person"
            value={fromUserId}
            people={people}
            disabled={replace.isPending}
            onChange={(id) => {
              setFromUserId(id);
              if (id === to) setTo(null);
            }}
          />
          <PersonSelect
            label="Replace with"
            placeholder="Choose a person"
            value={to}
            people={assignees.filter((person) => person.id !== fromUserId)}
            withNobody
            disabled={replace.isPending}
            onChange={setTo}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeCompleted}
              disabled={replace.isPending}
              onChange={(event) => setIncludeCompleted(event.target.checked)}
              className="size-4 cursor-pointer rounded border-input accent-primary"
            />
            Include completed tasks
          </label>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {summary}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={replace.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            loading={replace.isPending}
            disabled={!fromUserId || !to || !count.data}
            onClick={submit}
          >
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonSelect({
  label,
  placeholder,
  value,
  people,
  withNobody = false,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  people: UserRef[];
  withNobody?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
      <span className="text-sm">{label}</span>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {withNobody && (
            <SelectItem value={NOBODY}>
              <span className="text-muted-foreground">No assignee</span>
            </SelectItem>
          )}
          {people.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              <span className="flex items-center gap-2">
                <PersonAvatar
                  name={person.name}
                  avatarUrl={person.avatarUrl ?? null}
                  className="size-5"
                  fallbackClassName="text-[9px]"
                />
                {person.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
