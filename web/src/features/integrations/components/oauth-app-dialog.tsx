import {
  MAX_OAUTH_REDIRECT_URIS,
  OAUTH_APP_DESCRIPTION_MAX_LENGTH,
  OAUTH_APP_NAME_MAX_LENGTH,
  redirectUriProblem,
} from '@coretask/contracts';
import type { CreatedOAuthApp, OAuthApp } from '@coretask/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/api-error';

import { useCreateOAuthApp, useUpdateOAuthApp } from '../hooks/use-oauth';
import { CopyField } from './copy-field';
import { SecretReveal } from './secret-reveal';

/** One URI per line, as typed; blank lines are nothing. */
const linesOf = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the app — people see this name when they allow it.')
    .max(OAUTH_APP_NAME_MAX_LENGTH),
  description: z.string().trim().max(OAUTH_APP_DESCRIPTION_MAX_LENGTH),
  websiteUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || /^https?:\/\/\S+$/.test(value), 'Enter a full URL.'),
  redirectUris: z.string().superRefine((value, ctx) => {
    const uris = linesOf(value);
    if (uris.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Add the URL CoreTask sends people back to.' });
      return;
    }
    if (uris.length > MAX_OAUTH_REDIRECT_URIS) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${MAX_OAUTH_REDIRECT_URIS} redirect URIs.`,
      });
      return;
    }
    for (const uri of uris) {
      const problem = redirectUriProblem(uri);
      if (problem) {
        ctx.addIssue({ code: 'custom', message: `${uri}: ${problem}` });
        return;
      }
    }
  }),
});
type FormInput = z.input<typeof formSchema>;

const EMPTY: FormInput = { name: '', description: '', websiteUrl: '', redirectUris: '' };

interface OAuthAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this app; registering a new one when null. */
  app: OAuthApp | null;
}

/**
 * Register or edit an OAuth app. Registering is two steps in one dialog: the
 * form, then the client id and the secret — which lives only in this
 * component's state and is gone when the dialog closes.
 */
export function OAuthAppDialog({ open, onOpenChange, app }: OAuthAppDialogProps) {
  const create = useCreateOAuthApp();
  const update = useUpdateOAuthApp();
  const [created, setCreated] = useState<CreatedOAuthApp | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    reset(
      app
        ? {
            name: app.name,
            description: app.description ?? '',
            websiteUrl: app.websiteUrl ?? '',
            redirectUris: app.redirectUris.join('\n'),
          }
        : EMPTY,
    );
    create.reset();
    update.reset();
    // The mutations are reset on open only; listing them would reset them on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setCreated(null);
    onOpenChange(next);
  };

  const onSubmit = handleSubmit((values) => {
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      websiteUrl: values.websiteUrl.trim() || null,
      redirectUris: linesOf(values.redirectUris),
    };
    if (app) {
      update.mutate({ appId: app.id, payload }, { onSuccess: () => handleOpenChange(false) });
    } else {
      create.mutate(payload, { onSuccess: (result) => setCreated(result) });
    }
  });

  const failure = (app ? update : create).error;
  const submitError =
    failure instanceof ApiError
      ? failure.message
      : failure
        ? 'Something went wrong. Please try again.'
        : null;
  const busy = isSubmitting || create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>“{created.app.name}” is registered</DialogTitle>
              <DialogDescription>
                Put these in your tool. The client id goes in the authorization link; the secret
                stays on your server.
              </DialogDescription>
            </DialogHeader>

            <CopyField label="Client id" value={created.app.clientId} id="created-client-id" />
            <SecretReveal secret={created.clientSecret} label="Client secret" id="created-secret" />

            <p
              role="note"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Copy the secret now — it won’t be shown again.</span>
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
              <DialogTitle>{app ? `Edit “${app.name}”` : 'Register an OAuth app'}</DialogTitle>
              <DialogDescription>
                For a tool that acts for the people who connect it — the way Zapier or Make connects
                to Asana.
              </DialogDescription>
            </DialogHeader>

            <FormError message={submitError} />

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <Field label="Name" htmlFor="oauth-app-name" error={errors.name?.message} required>
                <Input
                  {...fieldAria('oauth-app-name', errors.name?.message)}
                  {...register('name')}
                  placeholder="Leasing sync"
                  autoComplete="off"
                  autoFocus
                  disabled={busy}
                />
              </Field>

              <Field
                label="Description"
                htmlFor="oauth-app-description"
                error={errors.description?.message}
                hint="Shown to people when they decide whether to allow it."
              >
                <Textarea
                  {...fieldAria(
                    'oauth-app-description',
                    errors.description?.message,
                    'Shown to people when they decide whether to allow it.',
                  )}
                  {...register('description')}
                  rows={2}
                  disabled={busy}
                />
              </Field>

              <Field label="Website" htmlFor="oauth-app-website" error={errors.websiteUrl?.message}>
                <Input
                  {...fieldAria('oauth-app-website', errors.websiteUrl?.message)}
                  {...register('websiteUrl')}
                  placeholder="https://example.com"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>

              <Field
                label="Redirect URIs"
                htmlFor="oauth-app-redirects"
                error={errors.redirectUris?.message}
                hint="One per line. https, or http on localhost while developing. Matched exactly."
                required
              >
                <Textarea
                  {...fieldAria(
                    'oauth-app-redirects',
                    errors.redirectUris?.message,
                    'One per line. https, or http on localhost while developing. Matched exactly.',
                  )}
                  {...register('redirectUris')}
                  rows={3}
                  placeholder="https://example.com/oauth/callback"
                  className="font-mono text-xs"
                  disabled={busy}
                />
              </Field>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {app ? 'Save' : 'Register app'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
