import { MAX_TASK_EXTRA_PROJECTS, PAGINATION_MAX_LIMIT } from '@coretask/contracts';
import type { TaskProjectMembership } from '@coretask/types';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProject, useProjects } from '@/features/projects/hooks/use-projects';

import {
  useAddTaskToProject,
  useRemoveTaskFromProject,
  useSetTaskProjectSection,
} from '../hooks/use-tasks';

const NO_SECTION = 'NO_SECTION';

/** A project chip: the colour square and the name, as the pane draws its home. */
function ProjectChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-sm">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * One of the other projects a task is in — multi-homing — with its own section
 * there and a way out. The section is that project's: moving it here moves
 * the task on that board alone.
 */
export function OtherProjectRow({
  workspaceId,
  taskId,
  membership,
  canEdit,
}: {
  workspaceId: string | undefined;
  taskId: string;
  membership: TaskProjectMembership;
  canEdit: boolean;
}) {
  const { data: project } = useProject(workspaceId, membership.project.id);
  const setSection = useSetTaskProjectSection(workspaceId);
  const remove = useRemoveTaskFromProject(workspaceId);
  const sections = project?.sections ?? [];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <ProjectChip name={membership.project.name} color={membership.project.color} />
      {sections.length > 0 && (
        <Select
          value={membership.section?.id ?? NO_SECTION}
          onValueChange={(value) => {
            // Radix reports '' while the sections are still arriving.
            if (!value || !canEdit) return;
            setSection.mutate({
              taskId,
              projectId: membership.project.id,
              sectionId: value === NO_SECTION ? null : value,
            });
          }}
          disabled={!canEdit || setSection.isPending}
        >
          <SelectTrigger
            aria-label={`Section in ${membership.project.name}`}
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
      {canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove from ${membership.project.name}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate({ taskId, projectId: membership.project.id })}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/**
 * "Add to another project": a searchable list of the projects the task is not
 * in yet. The task lands in the chosen project's first section, as Asana's
 * picker files it; the section can be changed beside it afterwards.
 */
export function AddToProjectPicker({
  workspaceId,
  taskId,
  excludeIds,
}: {
  workspaceId: string | undefined;
  taskId: string;
  excludeIds: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const { data } = useProjects(open ? workspaceId : undefined, { limit: PAGINATION_MAX_LIMIT });
  const add = useAddTaskToProject(workspaceId);

  const atLimit = excludeIds.length > MAX_TASK_EXTRA_PROJECTS;
  const candidates = (data?.items ?? []).filter(
    (project) => !excludeIds.includes(project.id) && project.archivedAt === null,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          disabled={atLimit || add.isPending}
          title={atLimit ? 'A task can be in this many projects at most.' : undefined}
        >
          <Plus />
          Add to project
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Project name" />
          <CommandList>
            <CommandEmpty>No other projects to add it to.</CommandEmpty>
            <CommandGroup>
              {candidates.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.name} ${project.key}`}
                  onSelect={() => {
                    add.mutate({ taskId, projectId: project.id });
                    setOpen(false);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="truncate">{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The home project's way out — only offered while the task is in another to fall back on. */
export function RemoveFromHomeButton({
  workspaceId,
  taskId,
  projectId,
  projectName,
}: {
  workspaceId: string | undefined;
  taskId: string;
  projectId: string;
  projectName: string;
}) {
  const remove = useRemoveTaskFromProject(workspaceId);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Remove from ${projectName}`}
      disabled={remove.isPending}
      onClick={() => remove.mutate({ taskId, projectId })}
    >
      <X />
    </Button>
  );
}
