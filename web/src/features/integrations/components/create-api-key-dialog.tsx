import { API_KEY_ROLES, WorkspaceRole, grantableRoles } from '@coretask/contracts';
import type { ApiKey } from '@coretask/types';
import { apiKeyNameSchema, apiKeyRoleSchema } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
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

import { useCreateApiKey } from '../hooks/use-api-keys';
import { SecretReveal } from './secret-reveal';

/** Radix `Select` treats `''` as "no value", so "no expiry" needs a real token. */
const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires', days: null },
  { value: '30', label: 'In 30 days', days: 30 },
  { value: '90', label: 'In 90 days', days: 90 },
  { value: '365', label: 'In a year', days: 365 },
] as const;

const formSchema = z.object({
  name: apiKeyNameSchema,
  role: apiKeyRoleSchema,
  expiry: z.enum(['never', '30', '90', '365']),
});
type FormInput = z.input<typeof formSchema>;

const DEFAULTS: FormInput = { name: '', role: WorkspaceRole.MEMBER, expiry: 'never' };

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** The admin's role — a key never gets more than its creator could grant. */
  actorRole: WorkspaceRole;
}

/**
 * Two steps in one dialog: the form, then the secret.
 *
 * The secret lives only in this component's state and the mutation's result;
 * closing the dialog clears both, and the list is refetched without it.
 */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
  workspaceId,
  actorRole,
}: CreateApiKeyDialogProps) {
  const create = useCreateApiKey(workspaceId);
  const [created, setCreated] = useState<{ key: ApiKey; secret: string } | null>(null);

  // The same rule the API enforces: what the caller may grant, narrowed to
  // what a key may hold.
  const roles = grantableRoles(actorRole).filter((role) =>
    (API_KEY_ROLES as readonly string[]).includes(role),
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({ resolver: zodResolver(formSchema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (!open) return;

    reset(DEFAULTS);
    create.reset();
    // The mutation object is stable; including it would clear the error the
    // moment it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  // The secret is forgotten the moment the dialog closes, whichever way it
  // closes — Done, Cancel, Escape or a click outside.
  const handleOpenChange = (next: boolean) => {
    if (!next) setCreated(null);
    onOpenChange(next);
  };

  const onSubmit = handleSubmit((values) => {
    const expiry = EXPIRY_OPTIONS.find((option) => option.value === values.expiry);

    create.mutate(
      {
        name: values.name,
        role: values.role as (typeof API_KEY_ROLES)[number],
        expiresInDays: expiry?.days ?? null,
      },
      { onSuccess: (result) => setCreated({ key: result.key, secret: result.secret }) },
    );
  });

  const submitError =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || create.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Your new API key</DialogTitle>
              <DialogDescription>
                “{created.key.name}” can now act in this workspace as a{' '}
                {humanizeEnum(created.key.role).toLowerCase()}.
              </DialogDescription>
            </DialogHeader>

            <SecretReveal secret={created.secret} label="API key" id="created-api-key" />

            <p
              role="note"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Copy it now — it won’t be shown again.</span>
            </p>

            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                For a tool such as n8n. The key acts as its own account, named after it, so the
                history says which tool did what.
              </DialogDescription>
            </DialogHeader>

            <FormError message={submitError} />

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <Field label="Name" htmlFor="api-key-name" error={errors.name?.message} required>
                <Input
                  {...fieldAria('api-key-name', errors.name?.message)}
                  {...register('name')}
                  placeholder="n8n"
                  autoComplete="off"
                  autoFocus
                  disabled={busy}
                />
              </Field>

              <Field
                label="Role"
                htmlFor="api-key-role"
                error={errors.role?.message}
                hint="What the key may do. Member is right for creating and completing tasks."
              >
                <Controller
                  control={control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                      <SelectTrigger id="api-key-role" className="w-full">
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

              <Field label="Expires" htmlFor="api-key-expiry" error={errors.expiry?.message}>
                <Controller
                  control={control}
                  name="expiry"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                      <SelectTrigger id="api-key-expiry" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
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
                  onClick={() => handleOpenChange(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={busy}>
                  {busy ? 'Creating…' : 'Create key'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
