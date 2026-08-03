import {
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_TYPES,
  TicketPriority,
  TicketSeverity,
  TicketType,
} from '@coretask/contracts';
import type { CreateTicketPayload } from '@coretask/types';
import { ticketFormSchema, type TicketFormInput } from '@coretask/validation';
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
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import { humanizeEnum } from '@/lib/utils';

import { useCreateTicket } from '../hooks/use-tickets';

interface TicketFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** Preselects the project when reporting from inside one. */
  defaultProjectId?: string | null;
}

/** Sentinel for "no project" / "nobody" — a Radix SelectItem cannot have an empty value. */
const NONE = '__none__';

const EMPTY: TicketFormInput = {
  title: '',
  description: '',
  type: TicketType.BUG,
  priority: TicketPriority.MEDIUM,
  severity: TicketSeverity.MINOR,
  projectId: NONE,
  assigneeId: NONE,
  dueDate: '',
};

/**
 * Reporting only. Status is not offered: a ticket being filed is OPEN, and
 * anything else is a triage decision made from the detail view afterwards.
 */
export function TicketFormDialog({
  open,
  onOpenChange,
  workspaceId,
  defaultProjectId = null,
}: TicketFormDialogProps) {
  const createTicket = useCreateTicket(workspaceId);
  const { data: projects } = useProjects(workspaceId, { limit: 100 });
  const { data: members } = useWorkspaceMembers(workspaceId);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TicketFormInput>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset({ ...EMPTY, projectId: defaultProjectId ?? NONE });
    createTicket.reset();
    // The mutation object is stable; including it would clear the error as soon
    // as it is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProjectId, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const payload: CreateTicketPayload = {
      title: values.title,
      ...(values.description ? { description: values.description } : {}),
      type: values.type as CreateTicketPayload['type'],
      priority: values.priority as CreateTicketPayload['priority'],
      severity: values.severity as CreateTicketPayload['severity'],
      projectId: values.projectId === NONE ? null : values.projectId,
      assigneeId: values.assigneeId === NONE ? null : values.assigneeId,
      dueDate: values.dueDate || null,
    };

    await createTicket.mutateAsync(payload);
    onOpenChange(false);
  });

  const submitError =
    createTicket.error instanceof ApiError
      ? createTicket.error.message
      : createTicket.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || createTicket.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Report a ticket</DialogTitle>
          <DialogDescription>
            The key is assigned by the server and stays with the ticket for good.
          </DialogDescription>
        </DialogHeader>

        <FormError message={submitError} />

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Summary" htmlFor="ticket-title" error={errors.title?.message} required>
            <Input
              {...fieldAria('ticket-title', errors.title?.message)}
              {...register('title')}
              placeholder="Attachment upload times out on files above 10 MB"
              autoFocus
              disabled={busy}
            />
          </Field>

          <Field label="Details" htmlFor="ticket-description" error={errors.description?.message}>
            <Textarea
              {...fieldAria('ticket-description', errors.description?.message)}
              {...register('description')}
              placeholder="What happened, what you expected, and how to reproduce it (optional)"
              rows={4}
              disabled={busy}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <EnumField
              control={control}
              name="type"
              label="Type"
              options={TICKET_TYPES}
              busy={busy}
              error={errors.type?.message}
            />
            <EnumField
              control={control}
              name="priority"
              label="Priority"
              options={TICKET_PRIORITIES}
              busy={busy}
              error={errors.priority?.message}
            />
            <EnumField
              control={control}
              name="severity"
              label="Severity"
              options={TICKET_SEVERITIES}
              busy={busy}
              error={errors.severity?.message}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project" htmlFor="ticket-project" error={errors.projectId?.message}>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                    <SelectTrigger id="ticket-project" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unassigned to a project</SelectItem>
                      {(projects?.items ?? []).map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.key} · {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Assignee" htmlFor="ticket-assignee" error={errors.assigneeId?.message}>
              <Controller
                control={control}
                name="assigneeId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                    <SelectTrigger id="ticket-assignee" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unassigned</SelectItem>
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
          </div>

          <Field label="Due date" htmlFor="ticket-due" error={errors.dueDate?.message}>
            <Input
              {...fieldAria('ticket-due', errors.dueDate?.message)}
              {...register('dueDate')}
              type="date"
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
              {busy ? 'Reporting…' : 'Report ticket'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The three enum selects differ only by their option list. */
function EnumField({
  control,
  name,
  label,
  options,
  busy,
  error,
}: {
  control: ReturnType<typeof useForm<TicketFormInput>>['control'];
  name: 'type' | 'priority' | 'severity';
  label: string;
  options: readonly string[];
  busy: boolean;
  error?: string;
}) {
  const id = `ticket-${name}`;

  return (
    <Field label={label} htmlFor={id} error={error}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {humanizeEnum(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );
}
