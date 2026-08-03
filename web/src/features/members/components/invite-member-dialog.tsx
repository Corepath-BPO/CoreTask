import { WorkspaceRole, grantableRoles } from '@coretask/contracts';
import { createInvitationSchema, type CreateInvitationInput } from '@coretask/validation';
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
import { ApiError } from '@/lib/api/api-error';
import { humanizeEnum } from '@/lib/utils';

import { useInviteMember } from '../hooks/use-invitations';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** The inviter's role — nobody may hand out more than they hold. */
  actorRole: WorkspaceRole;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  actorRole,
}: InviteMemberDialogProps) {
  const invite = useInviteMember(workspaceId);

  // The same rule the API enforces, so the picker never offers a role the
  // server would reject. The API remains the boundary; this is just courtesy.
  const roles = grantableRoles(actorRole);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationInput>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: '', role: WorkspaceRole.MEMBER },
  });

  useEffect(() => {
    if (!open) return;

    reset({ email: '', role: WorkspaceRole.MEMBER });
    invite.reset();
    // The mutation object is stable; including it would clear the error the
    // moment it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  const onSubmit = handleSubmit((values) => {
    invite.mutate(
      { email: values.email, role: values.role as WorkspaceRole },
      { onSuccess: () => onOpenChange(false) },
    );
  });

  const submitError =
    invite.error instanceof ApiError
      ? invite.error.message
      : invite.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || invite.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They receive a link that expires in a week. It only works for this address.
          </DialogDescription>
        </DialogHeader>

        <FormError message={submitError} />

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="E-mail" htmlFor="invite-email" error={errors.email?.message} required>
            <Input
              {...fieldAria('invite-email', errors.email?.message)}
              {...register('email')}
              type="email"
              placeholder="teammate@example.com"
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </Field>

          <Field label="Role" htmlFor="invite-role" error={errors.role?.message}>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {humanizeEnum(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
              {busy ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
