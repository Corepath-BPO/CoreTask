import { API_KEY_ROLES, type WorkspaceRole, grantableRoles } from '@coretask/contracts';
import type { ApiKey } from '@coretask/types';
import { apiKeyNameSchema, apiKeyRoleSchema } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

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

import { useUpdateApiKey } from '../hooks/use-api-keys';

const formSchema = z.object({ name: apiKeyNameSchema, role: apiKeyRoleSchema });
type FormInput = z.input<typeof formSchema>;

interface RenameApiKeyDialogProps {
  apiKey: ApiKey | null;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  actorRole: WorkspaceRole;
}

/** Name and role — the two things about a key that can change after it exists. */
export function RenameApiKeyDialog({
  apiKey,
  onOpenChange,
  workspaceId,
  actorRole,
}: RenameApiKeyDialogProps) {
  const update = useUpdateApiKey(workspaceId);

  const roles = grantableRoles(actorRole).filter((role) =>
    (API_KEY_ROLES as readonly string[]).includes(role),
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', role: 'MEMBER' },
  });

  useEffect(() => {
    if (!apiKey) return;

    reset({ name: apiKey.name, role: apiKey.role });
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, reset]);

  const onSubmit = handleSubmit((values) => {
    if (!apiKey) return;

    update.mutate(
      {
        apiKeyId: apiKey.id,
        payload: { name: values.name, role: values.role as (typeof API_KEY_ROLES)[number] },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  });

  const submitError =
    update.error instanceof ApiError
      ? update.error.message
      : update.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || update.isPending;

  return (
    <Dialog open={apiKey !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit API key</DialogTitle>
          <DialogDescription>
            Renaming also renames the account the key acts as, so past activity reads the new name.
          </DialogDescription>
        </DialogHeader>

        <FormError message={submitError} />

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Name" htmlFor="edit-api-key-name" error={errors.name?.message} required>
            <Input
              {...fieldAria('edit-api-key-name', errors.name?.message)}
              {...register('name')}
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </Field>

          <Field label="Role" htmlFor="edit-api-key-role" error={errors.role?.message}>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                  <SelectTrigger id="edit-api-key-role" className="w-full">
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
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
