import { createWorkspaceSchema, slugify, type CreateWorkspaceInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

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
import { ApiError } from '@/lib/api/api-error';

import { useCreateWorkspace } from '../hooks/use-workspaces';

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const createWorkspace = useCreateWorkspace();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: '', description: '' },
  });

  // Clear stale values and errors whenever the dialog is reopened.
  useEffect(() => {
    if (open) {
      reset({ name: '', description: '' });
      createWorkspace.reset();
    }
    // `createWorkspace` is a stable mutation object; re-running on its identity
    // would reset the error the moment it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  const name = watch('name') ?? '';
  const previewSlug = slugify(name);

  const onSubmit = handleSubmit(async (values) => {
    await createWorkspace.mutateAsync({
      name: values.name,
      ...(values.description ? { description: values.description } : {}),
    });
    onOpenChange(false);
  });

  const submitError =
    createWorkspace.error instanceof ApiError
      ? createWorkspace.error.message
      : createWorkspace.error
        ? 'Could not create the workspace. Please try again.'
        : null;

  const busy = isSubmitting || createWorkspace.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            Workspaces keep projects, tickets and members separate. You will be its owner.
          </DialogDescription>
        </DialogHeader>

        <FormError message={submitError} />

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field
            label="Workspace name"
            htmlFor="workspace-name"
            error={errors.name?.message}
            hint={previewSlug ? `URL: /w/${previewSlug}` : undefined}
            required
          >
            <Input
              {...fieldAria('workspace-name', errors.name?.message, 'workspace url')}
              {...register('name')}
              placeholder="Acme Product"
              autoFocus
              disabled={busy}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="workspace-description"
            error={errors.description?.message}
          >
            <Input
              {...fieldAria('workspace-description', errors.description?.message)}
              {...register('description')}
              placeholder="What this workspace is for (optional)"
              disabled={busy}
            />
          </Field>

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
              {busy ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
