import { PROJECT_COLORS } from '@coretask/contracts';
import type { Team } from '@coretask/types';
import { teamFormSchema, type TeamFormInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
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
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import { cn } from '@/lib/utils';

import { useCreateTeam, useUpdateTeam } from '../hooks/use-teams';

/** Radix `Select` treats `''` as "no value", so absence needs a real token. */
const NO_LEAD = 'none';

interface TeamFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** Omitted when creating. */
  team?: Team | null;
}

const EMPTY: TeamFormInput = {
  name: '',
  description: '',
  color: PROJECT_COLORS[0] as string,
  leadId: '',
};

export function TeamFormDialog({
  open,
  onOpenChange,
  workspaceId,
  team = null,
}: TeamFormDialogProps) {
  const isEdit = team !== null;
  const createTeam = useCreateTeam(workspaceId);
  const updateTeam = useUpdateTeam(workspaceId);
  const mutation = isEdit ? updateTeam : createTeam;

  const { data: members } = useWorkspaceMembers(workspaceId);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TeamFormInput>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      team
        ? {
            name: team.name,
            description: team.description ?? '',
            color: team.color,
            leadId: team.leadId ?? '',
          }
        : EMPTY,
    );
    createTeam.reset();
    updateTeam.reset();
    // Mutation objects are stable; including them would clear the error the
    // moment it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team, reset]);

  const onSubmit = handleSubmit((values) => {
    const payload = {
      name: values.name,
      description: values.description || null,
      color: values.color,
      leadId: values.leadId || null,
    };

    if (isEdit) {
      updateTeam.mutate(
        { teamId: team.id, payload },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createTeam.mutate(
        { ...payload, description: values.description || undefined },
        { onSuccess: () => onOpenChange(false) },
      );
    }
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit team' : 'Create a team'}</DialogTitle>
          <DialogDescription>
            A team groups people and the projects they work on. It does not change what anyone is
            allowed to do — roles handle that.
          </DialogDescription>
        </DialogHeader>

        <FormError message={submitError} />

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Team name" htmlFor="team-name" error={errors.name?.message} required>
            <Input
              {...fieldAria('team-name', errors.name?.message)}
              {...register('name')}
              placeholder="Platform"
              autoFocus
              disabled={busy}
            />
          </Field>

          <Field label="Description" htmlFor="team-description" error={errors.description?.message}>
            <Textarea
              {...fieldAria('team-description', errors.description?.message)}
              {...register('description')}
              placeholder="What this team looks after (optional)"
              rows={2}
              disabled={busy}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Team lead"
              htmlFor="team-lead"
              error={errors.leadId?.message}
              hint="Leads can manage their own team"
            >
              <Controller
                control={control}
                name="leadId"
                render={({ field }) => (
                  <Select
                    value={field.value || NO_LEAD}
                    onValueChange={(value) => field.onChange(value === NO_LEAD ? '' : value)}
                    disabled={busy}
                  >
                    <SelectTrigger id="team-lead" className="w-full">
                      <SelectValue placeholder="No lead" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LEAD}>No lead</SelectItem>
                      {(members ?? []).map((member) => (
                        <SelectItem key={member.user.id} value={member.user.id}>
                          {member.user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Colour" htmlFor="team-color" error={errors.color?.message}>
              <Controller
                control={control}
                name="color"
                render={({ field }) => (
                  <div
                    id="team-color"
                    role="radiogroup"
                    aria-label="Team colour"
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
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create team'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
