import {
  MAX_OAUTH_REDIRECT_URIS,
  OAUTH_APP_DESCRIPTION_MAX_LENGTH,
  OAUTH_APP_NAME_MAX_LENGTH,
  OAuthClientType,
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

const formSchema = z
  .object({
    clientType: z.enum([OAuthClientType.CONFIDENTIAL, OAuthClientType.PUBLIC]),
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
    redirectUris: z.string(),
  })
  // Against the app's type: an app scheme is a public client's to register.
  .superRefine((value, ctx) => {
    const uris = linesOf(value.redirectUris);
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message, path: ['redirectUris'] });
    if (uris.length === 0) return issue('Add the URL CoreTask sends people back to.');
    if (uris.length > MAX_OAUTH_REDIRECT_URIS) {
      return issue(`At most ${MAX_OAUTH_REDIRECT_URIS} redirect URIs.`);
    }
    for (const uri of uris) {
      const problem = redirectUriProblem(uri, {
        publicClient: value.clientType === OAuthClientType.PUBLIC,
      });
      if (problem) return issue(`${uri}: ${problem}`);
    }
  });
type FormInput = z.input<typeof formSchema>;

const EMPTY: FormInput = {
  clientType: OAuthClientType.CONFIDENTIAL,
  name: '',
  description: '',
  websiteUrl: '',
  redirectUris: '',
};

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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });
  const isPublic = watch('clientType') === OAuthClientType.PUBLIC;

  useEffect(() => {
    if (!open) return;
    reset(
      app
        ? {
            clientType: app.clientType,
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
      create.mutate(
        { ...payload, clientType: values.clientType },
        { onSuccess: (result) => setCreated(result) },
      );
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
                {created.clientSecret
                  ? 'Put these in your tool. The client id goes in the authorization link; the secret stays on your server.'
                  : 'A mobile or desktop app has no secret. Put the client id in the app, and send a PKCE code challenge with every authorization.'}
              </DialogDescription>
            </DialogHeader>

            <CopyField label="Client id" value={created.app.clientId} id="created-client-id" />
            {created.clientSecret && (
              <>
                <SecretReveal
                  secret={created.clientSecret}
                  label="Client secret"
                  id="created-secret"
                />

                <p
                  role="note"
                  className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>Copy the secret now — it won’t be shown again.</span>
                </p>
              </>
            )}

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
              {/* The type is fixed once registered: a secret cannot be taken
                  back out of a published app, or given to one later. */}
              <fieldset className="space-y-2" disabled={busy || app !== null}>
                <legend className="text-sm font-medium">Kind of app</legend>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="radio"
                    value={OAuthClientType.CONFIDENTIAL}
                    {...register('clientType')}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="font-medium">Runs on a server</span>
                    <span className="block text-xs text-muted-foreground">
                      Keeps a client secret. Zapier, Make, a back end of your own.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="radio"
                    value={OAuthClientType.PUBLIC}
                    {...register('clientType')}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="font-medium">Mobile or desktop app</span>
                    <span className="block text-xs text-muted-foreground">
                      No secret: it uses PKCE every time, and its refresh tokens are replaced on
                      use. It may return to an app scheme such as com.example.app:/callback.
                    </span>
                  </span>
                </label>
              </fieldset>

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
                hint={
                  isPublic
                    ? 'One per line. https, http on localhost, or an app scheme like com.example.app:/callback. Matched exactly.'
                    : 'One per line. https, or http on localhost while developing. Matched exactly.'
                }
                required
              >
                <Textarea
                  {...fieldAria(
                    'oauth-app-redirects',
                    errors.redirectUris?.message,
                    isPublic
                      ? 'One per line. https, http on localhost, or an app scheme like com.example.app:/callback. Matched exactly.'
                      : 'One per line. https, or http on localhost while developing. Matched exactly.',
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
