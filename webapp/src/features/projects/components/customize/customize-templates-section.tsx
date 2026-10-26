import {
  MAX_TEMPLATE_SUBTASKS,
  TASK_KINDS,
  TASK_KIND_LABEL,
  TASK_TEMPLATE_NAME_MAX,
  TASK_TITLE_MAX_LENGTH,
  TaskKind,
} from '@coretask/contracts';
import type { TaskTemplate, TaskTemplateDraft } from '@coretask/types';
import { LayoutTemplate, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';

import {
  useDeleteTaskTemplate,
  useSaveTaskTemplate,
  useTaskTemplates,
  useUseTaskTemplate,
} from '../../hooks/use-task-templates';

const NOBODY = 'NOBODY';

/** Stored rich text, as the plain text a textarea edits. */
function plainText(html: string | null): string {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/**
 * Customize › Task types and templates: the project's ready-made tasks.
 *
 * Each can be used from here or from the Add menu, and makes a task with its
 * subtasks in one step — "Lease renewal" with its six-item checklist rather
 * than six tasks typed in by hand every time.
 */
export function CustomizeTemplatesSection({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: templates, isLoading } = useTaskTemplates(workspaceId, projectId);
  const remove = useDeleteTaskTemplate(workspaceId, projectId);
  const use = useUseTaskTemplate(workspaceId, projectId);
  const [editing, setEditing] = useState<TaskTemplate | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ready-made tasks, with their subtasks, that the Add menu can create in one step.
      </p>

      {canEdit && (
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus />
          New template
        </Button>
      )}

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !templates || templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <LayoutTemplate className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No task templates yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.id} className="space-y-2 rounded-lg border px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{template.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {template.title}
                    {template.subtasks.length > 0 &&
                      ` · ${template.subtasks.length} subtask${template.subtasks.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                {template.kind !== TaskKind.TASK && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {TASK_KIND_LABEL[template.kind]}
                  </Badge>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={use.isPending}
                    onClick={() => use.mutate({ templateId: template.id })}
                  >
                    Use
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>
                    Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete the template ${template.name}`}
                    className="ml-auto"
                    onClick={() => remove.mutate(template.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? 'New task template' : 'Edit task template'}
            </DialogTitle>
            <DialogDescription>
              The task — and its subtasks — the template creates each time it is used.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <TemplateForm
              workspaceId={workspaceId}
              projectId={projectId}
              template={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateForm({
  workspaceId,
  projectId,
  template,
  onDone,
}: {
  workspaceId: string | undefined;
  projectId: string;
  template: TaskTemplate | null;
  onDone: () => void;
}) {
  const save = useSaveTaskTemplate(workspaceId, projectId);
  const { data: members } = useWorkspaceMembers(workspaceId);

  const [name, setName] = useState(template?.name ?? '');
  const [title, setTitle] = useState(template?.title ?? '');
  const [description, setDescription] = useState(plainText(template?.description ?? null));
  const [kind, setKind] = useState<TaskKind>(template?.kind ?? TaskKind.TASK);
  const [assigneeId, setAssigneeId] = useState(template?.assigneeId ?? NOBODY);
  const [dueInDays, setDueInDays] = useState(
    template?.dueInDays !== null && template?.dueInDays !== undefined
      ? String(template.dueInDays)
      : '',
  );
  const [subtasks, setSubtasks] = useState<string[]>(
    template?.subtasks.map((subtask) => subtask.title) ?? [],
  );

  // A row added by the button takes the caret, so typing lands in it.
  const [focusNew, setFocusNew] = useState(false);

  const ready = name.trim() !== '' && title.trim() !== '' && !save.isPending;

  const submit = () => {
    if (!ready) return;
    const draft: TaskTemplateDraft = {
      name: name.trim(),
      title: title.trim(),
      description: description.trim() || null,
      kind,
      assigneeId: assigneeId === NOBODY ? null : assigneeId,
      dueInDays: dueInDays === '' ? null : Math.max(0, Math.trunc(Number(dueInDays))),
      subtasks: subtasks
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => ({ title: entry })),
    };
    save.mutate({ ...(template ? { templateId: template.id } : {}), draft }, { onSuccess: onDone });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="Template name" htmlFor="template-name">
        <Input
          id="template-name"
          value={name}
          maxLength={TASK_TEMPLATE_NAME_MAX}
          placeholder="e.g. Lease renewal"
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Task name" htmlFor="template-title">
        <Input
          id="template-title"
          value={title}
          maxLength={TASK_TITLE_MAX_LENGTH}
          placeholder="The title each task starts with"
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="Description" htmlFor="template-description">
        <Textarea
          id="template-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Type" htmlFor="template-kind">
          <Select value={kind} onValueChange={(value) => setKind(value as TaskKind)}>
            <SelectTrigger id="template-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {TASK_KIND_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Assignee" htmlFor="template-assignee">
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger id="template-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>Nobody</SelectItem>
              {(members ?? []).map((member) => (
                <SelectItem key={member.user.id} value={member.user.id}>
                  {member.user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Due in (days)" htmlFor="template-due">
          <Input
            id="template-due"
            type="number"
            min={0}
            max={365}
            value={dueInDays}
            onChange={(event) => setDueInDays(event.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Subtasks</p>
        {subtasks.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`Subtask ${index + 1}`}
              autoFocus={focusNew && index === subtasks.length - 1}
              value={entry}
              maxLength={TASK_TITLE_MAX_LENGTH}
              onChange={(event) =>
                setSubtasks((current) =>
                  current.map((value, at) => (at === index ? event.target.value : value)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove subtask ${index + 1}`}
              onClick={() => setSubtasks((current) => current.filter((_, at) => at !== index))}
            >
              <X />
            </Button>
          </div>
        ))}
        {subtasks.length < MAX_TEMPLATE_SUBTASKS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFocusNew(true);
              setSubtasks((current) => [...current, '']);
            }}
          >
            <Plus />
            Add subtask
          </Button>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Save template
        </Button>
      </DialogFooter>
    </form>
  );
}
