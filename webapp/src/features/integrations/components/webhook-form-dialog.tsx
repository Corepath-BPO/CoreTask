import type { SubscribableWebhookEvent } from '@coretask/contracts';
import type { WebhookEndpoint } from '@coretask/types';
import { webhookEventsSchema, webhookNameSchema, webhookUrlSchema } from '@coretask/validation';
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
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ApiError } from '@/lib/api/api-error';

import { useCreateWebhook, useUpdateWebhook } from '../hooks/use-webhooks';
import { SecretReveal } from './secret-reveal';
import { WebhookEventPicker } from './webhook-event-picker';

/** Radix `Select` treats `''` as "no value", so "every project" needs a real token. */
const ALL_PROJECTS = 'all';

const formSchema = z.object({
  name: webhookNameSchema,
  url: webhookUrlSchema,
  events: webhookEventsSchema,
  projectId: z.string(),
});
type FormInput = z.input<typeof formSchema>;

const EMPTY: FormInput = { name: '', url: '', events: [], projectId: ALL_PROJECTS };

interface WebhookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** Null creates; an endpoint edits it. */
  webhook: WebhookEndpoint | null;
}

/**
 * Create and edit in one dialog. Creating has a second step — the signing
 * secret, shown once — which editing never needs: the secret only changes
 * through "Rotate secret", deliberately a separate, confirmed action.
 */
export function WebhookFormDialog({
  open,
  onOpenChange,
  workspaceId,
  webhook,
}: WebhookFormDialogProps) {
  const create = useCreateWebhook(workspaceId);
  const update = useUpdateWebhook(workspaceId);
  const { data: projects } = useProjects(workspaceId, { limit: 100 });
  const [created, setCreated] = useState<{ endpoint: WebhookEndpoint; secret: string } | null>(
    null,
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;

    reset(
      webhook
        ? {
            name: webhook.name,
            url: webhook.url,
            events: webhook.events,
            projectId: webhook.project?.id ?? ALL_PROJECTS,
          }
        : EMPTY,
    );
    create.reset();
    update.reset();
    // The mutation objects are stable; including them would clear the error
    // the moment it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, webhook, reset]);

  // The secret is forgotten the moment the dialog closes, whichever way.
  const handleOpenChange = (next: boolean) => {
    if (!next) setCreated(null);
    onOpenChange(next);
  };

  const onSubmit = handleSubmit((values) => {
    const payload = {
      name: values.name,
      url: values.url,
      events: values.events as SubscribableWebhookEvent[],
      projectId: values.projectId === ALL_PROJECTS ? null : values.projectId,
    };

    if (webhook) {
      update.mutate(
        { endpointId: webhook.id, payload },
        { onSuccess: () => handleOpenChange(false) },
      );
    } else {
      create.mutate(payload, {
        onSuccess: (result) => setCreated({ endpoint: result.endpoint, secret: result.secret }),
      });
    }
  });

  const mutation = webhook ? update : create;
  const submitError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong. Please try again.'
        : null;
  const busy = isSubmitting || mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Endpoint added</DialogTitle>
              <DialogDescription>
                Every delivery to “{created.endpoint.name}” carries an{' '}
                <code className="font-mono text-xs">X-CoreTask-Signature</code> header signed with
                this secret, so the receiver can check it came from CoreTask.
              </DialogDescription>
            </DialogHeader>

            <SecretReveal
              secret={created.secret}
              label="Signing secret"
              id="created-webhook-secret"
            />

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
              <DialogTitle>
                {webhook ? 'Edit webhook endpoint' : 'Add a webhook endpoint'}
              </DialogTitle>
              <DialogDescription>
                CoreTask POSTs a JSON event to the URL whenever one of the chosen things happens.
              </DialogDescription>
            </DialogHeader>

            <FormError message={submitError} />

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <Field label="Name" htmlFor="webhook-name" error={errors.name?.message} required>
                <Input
                  {...fieldAria('webhook-name', errors.name?.message)}
                  {...register('name')}
                  placeholder="n8n — task sync"
                  autoComplete="off"
                  autoFocus
                  disabled={busy}
                />
              </Field>

              <Field label="URL" htmlFor="webhook-url" error={errors.url?.message} required>
                <Input
                  {...fieldAria('webhook-url', errors.url?.message)}
                  {...register('url')}
                  type="url"
                  inputMode="url"
                  placeholder="https://n8n.example.com/webhook/coretask"
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>

              <Field
                label="Events"
                htmlFor="webhook-events"
                error={errors.events?.message}
                required
              >
                <Controller
                  control={control}
                  name="events"
                  render={({ field }) => (
                    <div id="webhook-events">
                      <WebhookEventPicker
                        value={field.value as SubscribableWebhookEvent[]}
                        onChange={field.onChange}
                        disabled={busy}
                      />
                    </div>
                  )}
                />
              </Field>

              <Field
                label="Project"
                htmlFor="webhook-project"
                error={errors.projectId?.message}
                hint="Optional. Limit deliveries to one project."
              >
                <Controller
                  control={control}
                  name="projectId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                      <SelectTrigger id="webhook-project" className="w-full">
                        <SelectValue placeholder="All projects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                        {(projects?.items ?? []).map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
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
                  {busy ? 'Saving…' : webhook ? 'Save' : 'Add endpoint'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
