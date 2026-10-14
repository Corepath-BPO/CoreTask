import {
  BLUEPRINT_PARTS,
  BLUEPRINT_PART_LABEL,
  BLUEPRINT_PART_NEEDS,
  BlueprintPart,
  DEFAULT_DUPLICATE_PARTS,
  DEFAULT_TEMPLATE_PARTS,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_TEMPLATE_DESCRIPTION_MAX,
  PROJECT_TEMPLATE_NAME_MAX,
} from '@coretask/contracts';
import type { ProjectSummary, ProjectTemplate } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { LayoutTemplate, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  useDeleteProjectTemplate,
  useDuplicateProject,
  useProjectTemplates,
  useSaveProjectTemplate,
  useStartFromTemplate,
} from '../hooks/use-project-templates';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Which parts of a project to bring. Subtasks, assignees and dates only make
 * sense with the tasks, so they are offered under them and go when the tasks
 * do.
 */
export function PartsChecklist({
  parts,
  onChange,
}: {
  parts: BlueprintPart[];
  onChange: (parts: BlueprintPart[]) => void;
}) {
  const toggle = (part: BlueprintPart, on: boolean) => {
    if (on) {
      onChange(BLUEPRINT_PARTS.filter((entry) => entry === part || parts.includes(entry)));
    } else {
      onChange(parts.filter((entry) => entry !== part && BLUEPRINT_PART_NEEDS[entry] !== part));
    }
  };

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Include</legend>
      <p className="text-xs text-muted-foreground">Sections always come along.</p>
      <div className="space-y-1.5">
        {BLUEPRINT_PARTS.map((part) => {
          const needs = BLUEPRINT_PART_NEEDS[part];
          const blocked = needs !== undefined && !parts.includes(needs);
          return (
            <label
              key={part}
              className={cn(
                'flex items-center gap-2 text-sm',
                needs && 'pl-5',
                blocked && 'text-muted-foreground',
              )}
            >
              <Checkbox
                checked={parts.includes(part)}
                disabled={blocked}
                onCheckedChange={(checked) => toggle(part, checked === true)}
              />
              {BLUEPRINT_PART_LABEL[part]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** "Duplicate project": a copy with the parts chosen, opened once it exists. */
export function DuplicateProjectDialog({
  workspaceId,
  project,
  open,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate project</DialogTitle>
          <DialogDescription>
            A new project with the parts of “{project.name}” you choose. You run the copy.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <DuplicateForm
            workspaceId={workspaceId}
            project={project}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DuplicateForm({
  workspaceId,
  project,
  onDone,
}: {
  workspaceId: string | undefined;
  project: ProjectSummary;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const duplicate = useDuplicateProject(workspaceId);
  const [name, setName] = useState(
    `Duplicate of ${project.name}`.slice(0, PROJECT_NAME_MAX_LENGTH),
  );
  const [startDate, setStartDate] = useState(project.startDate?.slice(0, 10) ?? '');
  const [parts, setParts] = useState<BlueprintPart[]>([...DEFAULT_DUPLICATE_PARTS]);

  const ready = name.trim().length >= 2 && !duplicate.isPending;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        duplicate.mutate(
          {
            projectId: project.id,
            payload: {
              name: name.trim(),
              parts,
              // Only while dates come along: the field is hidden otherwise,
              // and the copy keeps the original's start.
              ...(startDate && parts.includes(BlueprintPart.DATES) ? { startDate } : {}),
            },
          },
          {
            onSuccess: (started) => {
              onDone();
              void navigate({
                to: '/projects/$projectId/list',
                params: { projectId: started.projectId },
              });
            },
          },
        );
      }}
    >
      <Field label="Name" htmlFor="duplicate-name">
        <Input
          id="duplicate-name"
          value={name}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      {parts.includes(BlueprintPart.DATES) && (
        <Field
          label="Start date"
          htmlFor="duplicate-start"
          hint="Task dates move with it, keeping their distance from the start."
        >
          <Input
            id="duplicate-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
      )}
      <PartsChecklist parts={parts} onChange={setParts} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready} loading={duplicate.isPending}>
          Duplicate
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Save as template": the project's blueprint, kept for the workspace. */
export function SaveTemplateDialog({
  workspaceId,
  project,
  open,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Anyone in the workspace can start a project from it. Task dates are kept as days from
            the project’s start.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <SaveTemplateForm
            workspaceId={workspaceId}
            project={project}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaveTemplateForm({
  workspaceId,
  project,
  onDone,
}: {
  workspaceId: string | undefined;
  project: ProjectSummary;
  onDone: () => void;
}) {
  const save = useSaveProjectTemplate(workspaceId);
  const [name, setName] = useState(project.name.slice(0, PROJECT_TEMPLATE_NAME_MAX));
  const [description, setDescription] = useState(project.description ?? '');
  const [parts, setParts] = useState<BlueprintPart[]>([...DEFAULT_TEMPLATE_PARTS]);

  const ready = name.trim() !== '' && !save.isPending;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        save.mutate(
          {
            projectId: project.id,
            name: name.trim(),
            description: description.trim() || null,
            parts,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Template name" htmlFor="template-name">
        <Input
          id="template-name"
          value={name}
          maxLength={PROJECT_TEMPLATE_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="template-description">
        <Textarea
          id="template-description"
          rows={2}
          value={description}
          maxLength={PROJECT_TEMPLATE_DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <PartsChecklist parts={parts} onChange={setParts} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready} loading={save.isPending}>
          Save template
        </Button>
      </DialogFooter>
    </form>
  );
}

/** One line of what a template holds. */
function contents(template: ProjectTemplate): string {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  return [
    plural(template.sectionCount, 'section'),
    template.taskCount > 0 && plural(template.taskCount, 'task'),
    template.fieldCount > 0 && plural(template.fieldCount, 'field'),
    template.ruleCount > 0 && plural(template.ruleCount, 'rule'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Use a template": pick one, name the project, choose when it starts. */
export function UseTemplateDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>
            Its sections, tasks, fields and rules, with task dates counted from your start date.
          </DialogDescription>
        </DialogHeader>
        {open && <UseTemplateForm workspaceId={workspaceId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function UseTemplateForm({
  workspaceId,
  onDone,
}: {
  workspaceId: string | undefined;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const { data: templates, isLoading } = useProjectTemplates(workspaceId);
  const start = useStartFromTemplate(workspaceId);
  const remove = useDeleteProjectTemplate(workspaceId);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today());

  const template = templates?.find((entry) => entry.id === chosen) ?? null;
  const ready = template !== null && name.trim().length >= 2 && !start.isPending;

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (!templates || templates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
        <LayoutTemplate className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          No templates yet. Open a project and choose “Save as template” from its menu.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || !template) return;
        start.mutate(
          { templateId: template.id, payload: { name: name.trim(), startDate } },
          {
            onSuccess: (started) => {
              onDone();
              void navigate({
                to: '/projects/$projectId/list',
                params: { projectId: started.projectId },
              });
            },
          },
        );
      }}
    >
      <ul role="radiogroup" aria-label="Templates" className="max-h-56 space-y-1.5 overflow-y-auto">
        {templates.map((entry) => (
          <li key={entry.id} className="flex items-center gap-1">
            <button
              type="button"
              role="radio"
              aria-checked={chosen === entry.id}
              onClick={() => {
                setChosen(entry.id);
                if (!name.trim()) setName(entry.name);
              }}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                chosen === entry.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
              )}
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{entry.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {contents(entry)}
                </span>
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete the template ${entry.name}`}
              onClick={() => {
                if (chosen === entry.id) setChosen(null);
                remove.mutate(entry.id);
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>

      {template && (
        <>
          <Field label="Project name" htmlFor="template-project-name">
            <Input
              id="template-project-name"
              value={name}
              maxLength={PROJECT_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Start date"
            htmlFor="template-start"
            hint="Task dates are counted from this day."
          >
            <Input
              id="template-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
        </>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready} loading={start.isPending}>
          Create project
        </Button>
      </DialogFooter>
    </form>
  );
}
