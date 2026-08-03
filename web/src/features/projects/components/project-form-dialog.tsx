import { PROJECT_COLORS, PROJECT_STATUSES, ProjectStatus } from '@coretask/contracts';
import type { ProjectSummary } from '@coretask/types';
import { deriveProjectKey, projectFormSchema, type ProjectFormInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { FormError } from '@/components/feedback/form-error';
import { fieldAria } from '@/components/forms/field-aria';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/api-error';
import { cn, humanizeEnum } from '@/lib/utils';

import { useCreateProject, useUpdateProject } from '../hooks/use-projects';

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** Omitted when creating. */
  project?: ProjectSummary | null;
}

const EMPTY: ProjectFormInput = {
  name: '',
  key: '',
  description: '',
  status: ProjectStatus.PLANNING,
  color: PROJECT_COLORS[0] as string,
  startDate: '',
  dueDate: '',
};

/** `2026-08-04T17:00:00.000Z` -> `2026-08-04` for a native date input. */
const toDateInput = (value: string | null): string => (value ? value.slice(0, 10) : '');

export function ProjectFormDialog({
  open,
  onOpenChange,
  workspaceId,
  project = null,
}: ProjectFormDialogProps) {
  const isEdit = project !== null;
  const createProject = useCreateProject(workspaceId);
  const updateProject = useUpdateProject(workspaceId);
  const mutation = isEdit ? updateProject : createProject;

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormInput>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      project
        ? {
            name: project.name,
            key: project.key,
            description: project.description ?? '',
            status: project.status,
            color: project.color,
            startDate: toDateInput(project.startDate),
            dueDate: toDateInput(project.dueDate),
          }
        : EMPTY,
    );
    createProject.reset();
    updateProject.reset();
    // Mutation objects are stable; including them would clear the error the
    // moment it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project, reset]);

  const name = watch('name') ?? '';
  const keyPreview = isEdit ? project.key : watch('key') || deriveProjectKey(name);

  const onSubmit = handleSubmit(async (values) => {
    if (isEdit) {
      await updateProject.mutateAsync({
        projectId: project.id,
        payload: {
          name: values.name,
          description: values.description || null,
          status: values.status as ProjectSummary['status'],
          color: values.color,
          startDate: values.startDate || null,
          dueDate: values.dueDate || null,
        },
      });
    } else {
      await createProject.mutateAsync({
        name: values.name,
        ...(values.key ? { key: values.key } : {}),
        ...(values.description ? { description: values.description } : {}),
        status: values.status as ProjectSummary['status'],
        color: values.color,
        ...(values.startDate ? { startDate: values.startDate } : {}),
        ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      });
    }

    onOpenChange(false);
  });

  const submitError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit project' : 'Create a project'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'The project key cannot change — it is part of every ticket reference.'
              : 'Four default sections are created so the board is usable straight away.'}
          </DialogDescription>
        </DialogHeader>

        <FormError message={submitError} />

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field
              label="Project name"
              htmlFor="project-name"
              error={errors.name?.message}
              required
            >
              <Input
                {...fieldAria('project-name', errors.name?.message)}
                {...register('name')}
                placeholder="Platform Foundation"
                autoFocus
                disabled={busy}
              />
            </Field>

            <Field
              label="Key"
              htmlFor="project-key"
              error={errors.key?.message}
              hint={isEdit ? 'Immutable' : `Auto: ${keyPreview}`}
            >
              <Input
                {...fieldAria('project-key', errors.key?.message, 'key hint')}
                {...register('key')}
                placeholder={keyPreview}
                className="font-mono uppercase"
                disabled={busy || isEdit}
                readOnly={isEdit}
              />
            </Field>
          </div>

          <Field
            label="Description"
            htmlFor="project-description"
            error={errors.description?.message}
          >
            <Textarea
              {...fieldAria('project-description', errors.description?.message)}
              {...register('description')}
              placeholder="What this project covers (optional)"
              rows={3}
              disabled={busy}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="project-status" error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                    <SelectTrigger id="project-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {humanizeEnum(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Colour" htmlFor="project-color" error={errors.color?.message}>
              <Controller
                control={control}
                name="color"
                render={({ field }) => (
                  <div
                    id="project-color"
                    role="radiogroup"
                    aria-label="Project colour"
                    className="flex flex-wrap items-center gap-1.5 pt-1"
                  >
                    {PROJECT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={field.value === color}
                        aria-label={color}
                        disabled={busy}
                        onClick={() => field.onChange(color)}
                        style={{ backgroundColor: color }}
                        className={cn(
                          'size-6 rounded-md ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                          field.value === color && 'ring-2 ring-foreground',
                        )}
                      />
                    ))}
                  </div>
                )}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="project-start" error={errors.startDate?.message}>
              <Input
                {...fieldAria('project-start', errors.startDate?.message)}
                {...register('startDate')}
                type="date"
                disabled={busy}
              />
            </Field>

            <Field label="Due date" htmlFor="project-due" error={errors.dueDate?.message}>
              <Input
                {...fieldAria('project-due', errors.dueDate?.message)}
                {...register('dueDate')}
                type="date"
                disabled={busy}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
