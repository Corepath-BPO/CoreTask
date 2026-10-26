import { useNavigate } from '@tanstack/react-router';
import { CircleUserRound, FolderKanban } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { useCurrentUser } from '@/stores/auth.store';

import { useCreateTask } from '../hooks/use-tasks';

/** Radix `Select` treats `''` as "no value", so absence needs a real token. */
const NONE = '__none__';

/**
 * Asana's Create → Task: a task from anywhere, without first finding the
 * project it belongs in.
 *
 * Assigned to whoever is creating it unless they say otherwise — a task made
 * from the top bar is nearly always "something I need to do" — and filed in a
 * project only if one is chosen; otherwise it lives in My Tasks.
 */
export function QuickAddTaskDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
}) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const createTask = useCreateTask(workspaceId, { announce: false });
  const { data: projects } = useProjects(open ? workspaceId : undefined, { limit: 100 });
  const { data: members } = useWorkspaceMembers(open ? workspaceId : undefined);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState<string>(me?.id ?? NONE);
  const [dueDate, setDueDate] = useState('');

  const reset = () => {
    setTitle('');
    setProjectId(NONE);
    setAssigneeId(me?.id ?? NONE);
    setDueDate('');
  };

  const submit = (keepOpen: boolean) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const chosenProject = projectId === NONE ? null : projectId;

    createTask.mutate(
      {
        title: trimmed,
        projectId: chosenProject,
        assigneeId: assigneeId === NONE ? null : assigneeId,
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null,
      },
      {
        onSuccess: (task) => {
          const href = chosenProject
            ? `/projects/${chosenProject}/list?task=${task.id}`
            : `/my-tasks?task=${task.id}`;
          toast.success(`Task "${trimmed}" created`, {
            action: { label: 'Open', onClick: () => void navigate({ to: href }) },
          });
          if (keepOpen) {
            setTitle('');
          } else {
            reset();
            onOpenChange(false);
          }
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Leave the project empty to keep it in My Tasks.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
        >
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Write a task name"
            aria-label="Task name"
            maxLength={500}
            className="h-11 text-base"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="quick-task-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="quick-task-project" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <span className="text-muted-foreground">No project</span>
                  </SelectItem>
                  {(projects?.items ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-sm"
                          style={{ backgroundColor: project.color }}
                          aria-hidden="true"
                        />
                        {project.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="quick-task-assignee">Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="quick-task-assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
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
                        {member.user.id === me?.id ? `${member.user.name} (me)` : member.user.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="quick-task-due">Due date</Label>
              <Input
                id="quick-task-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <FolderKanban className="size-3.5" aria-hidden="true" />
              Enter to create
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!title.trim() || createTask.isPending}
                onClick={() => submit(true)}
              >
                Create another
              </Button>
              <Button type="submit" loading={createTask.isPending} disabled={!title.trim()}>
                Create task
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
