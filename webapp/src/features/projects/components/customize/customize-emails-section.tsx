import {
  INBOUND_EMAIL_SENDERS,
  INBOUND_EMAIL_SENDER_LABEL,
  InboundEmailOutcome,
  type InboundEmailSender,
} from '@coretask/contracts';
import type { InboundEmailRecord, UpdateProjectEmailPayload } from '@coretask/types';
import { useNavigate } from '@tanstack/react-router';
import { CircleCheck, CircleSlash, Mail, MessageSquare, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { CopyButton } from '@/components/common/copy-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { formatRelativeTime } from '@/lib/utils/format';

import {
  useProjectEmail,
  useResetProjectEmail,
  useUpdateProjectEmail,
} from '../../hooks/use-project-email';
import { useProject } from '../../hooks/use-projects';

const FIRST_SECTION = 'FIRST_SECTION';

/**
 * Customize › Emails — Asana's "Add tasks via email".
 *
 * The project's address, to copy and hand out: mail sent to it becomes a task
 * here, and replies to a task's update emails become its comments. The two
 * checkboxes are Asana's; who may write and where new tasks land sit under
 * them, with the mail the address last received and what became of it.
 */
export function CustomizeEmailsSection({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: settings, isLoading } = useProjectEmail(
    canEdit ? workspaceId : undefined,
    projectId,
  );
  const { data: project } = useProject(canEdit ? workspaceId : undefined, projectId);
  const update = useUpdateProjectEmail(workspaceId, projectId);
  const reset = useResetProjectEmail(workspaceId, projectId);

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        Email sent to this project’s address becomes a task here. Ask a project editor for the
        address.
      </p>
    );
  }

  if (isLoading || !settings) {
    return <Skeleton className="h-40 w-full" />;
  }

  const save = (payload: UpdateProjectEmailPayload) => update.mutate(payload);

  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby="emails-add-tasks">
        <div>
          <h3 id="emails-add-tasks" className="text-sm font-semibold">
            Add tasks via email
          </h3>
          <p className="text-xs text-muted-foreground">
            To add new tasks to this project, send emails to the address provided.
          </p>
        </div>

        {settings.address ? (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={settings.address}
              aria-label="Project email address"
              className="h-8 font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton
              value={settings.address}
              label="Copy the project’s email address"
              successMessage="Email address copied"
              size="sm"
            />
          </div>
        ) : (
          <div
            role="note"
            className="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
          >
            This server is not receiving email yet. An administrator sets{' '}
            <code className="font-mono">INBOUND_EMAIL_DOMAIN</code> and{' '}
            <code className="font-mono">INBOUND_EMAIL_SECRET</code>, and points the mail provider’s
            inbound webhook at <code className="font-mono">/api/v1/inbound/email</code>. The
            settings below are kept until then.
          </div>
        )}

        <CheckRow
          id="emails-send-updates"
          checked={settings.sendUpdates}
          disabled={update.isPending}
          label="Send recipients task updates automatically"
          onChange={(sendUpdates) => save({ sendUpdates })}
        >
          Email addresses in the To and CC fields will automatically get task updates via email.
        </CheckRow>
        <CheckRow
          id="emails-add-collaborators"
          checked={settings.addCollaborators}
          disabled={update.isPending}
          label="Add members as task collaborators"
          onChange={(addCollaborators) => save({ addCollaborators })}
        >
          Members who participate in a task’s email thread will automatically be added as
          collaborators on the task.
        </CheckRow>
      </section>

      <section className="space-y-3" aria-labelledby="emails-settings">
        <h3 id="emails-settings" className="text-xs font-medium text-muted-foreground">
          Advanced settings
        </h3>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Taking email</span>
            <span className="block text-xs text-muted-foreground">
              Off, mail to the address is turned away.
            </span>
          </span>
          <Switch
            checked={settings.isActive}
            disabled={update.isPending}
            aria-label="Take email at this address"
            onCheckedChange={(isActive) => save({ isActive })}
          />
        </label>

        <div className="space-y-1">
          <label htmlFor="emails-accept-from" className="text-sm font-medium">
            Who can email this project
          </label>
          <Select
            value={settings.acceptFrom}
            onValueChange={(next) => {
              if (next && next !== settings.acceptFrom) {
                save({ acceptFrom: next as InboundEmailSender });
              }
            }}
          >
            <SelectTrigger id="emails-accept-from" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INBOUND_EMAIL_SENDERS.map((sender) => (
                <SelectItem key={sender} value={sender}>
                  {INBOUND_EMAIL_SENDER_LABEL[sender]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {settings.acceptFrom === 'ANYONE'
              ? 'Mail from people without an account is added under the name of whoever set the address up, and says who sent it.'
              : 'Mail from addresses that are not members’ is turned away.'}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="emails-section" className="text-sm font-medium">
            Add new tasks to
          </label>
          <Select
            value={settings.sectionId ?? FIRST_SECTION}
            onValueChange={(next) => {
              // '' arrives while the project's sections load; keep what was chosen.
              if (!next) return;
              const sectionId = next === FIRST_SECTION ? null : next;
              if (sectionId !== settings.sectionId) save({ sectionId });
            }}
          >
            <SelectTrigger id="emails-section" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FIRST_SECTION}>The first section</SelectItem>
              {(project?.sections ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={reset.isPending}>
              <RefreshCw />
              Get a new address
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Give this project a new address?</AlertDialogTitle>
              <AlertDialogDescription>
                The current address stops working, and so does replying to update emails already
                sent. Anyone who uses it will need the new one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => reset.mutate()}>
                Get a new address
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      <section className="space-y-2" aria-labelledby="emails-recent">
        <div className="flex items-baseline justify-between">
          <h3 id="emails-recent" className="text-xs font-medium text-muted-foreground">
            Recent emails
          </h3>
          {settings.receivedCount > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {settings.receivedCount} received
            </span>
          )}
        </div>
        {settings.recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center">
            <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Nothing has arrived yet.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {settings.recent.map((record) => (
              <RecentEmail key={record.id} projectId={projectId} record={record} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CheckRow({
  id,
  checked,
  disabled,
  label,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        className="mt-0.5"
        aria-describedby={`${id}-hint`}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

const OUTCOME = {
  [InboundEmailOutcome.TASK_CREATED]: {
    icon: CircleCheck,
    label: 'Task created',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  [InboundEmailOutcome.COMMENTED]: {
    icon: MessageSquare,
    label: 'Comment added',
    tone: 'text-sky-600 dark:text-sky-400',
  },
  [InboundEmailOutcome.REJECTED]: {
    icon: CircleSlash,
    label: 'Turned away',
    tone: 'text-muted-foreground',
  },
} as const;

function RecentEmail({ projectId, record }: { projectId: string; record: InboundEmailRecord }) {
  const navigate = useNavigate();
  const outcome = OUTCOME[record.outcome] ?? OUTCOME.REJECTED;
  const Icon = outcome.icon;

  return (
    <li className="flex items-start gap-2 rounded-md border px-2.5 py-2">
      <Icon className={`mt-0.5 size-4 shrink-0 ${outcome.tone}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{record.subject}</p>
        <p className="truncate text-xs text-muted-foreground">
          {outcome.label} · {record.fromAddress} · {formatRelativeTime(record.receivedAt)}
        </p>
        {record.reason && <p className="text-xs text-muted-foreground">{record.reason}</p>}
      </div>
      {record.taskId && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2"
          aria-label={`Open the task from “${record.subject}”`}
          onClick={() =>
            void navigate({
              to: '/projects/$projectId/list',
              params: { projectId },
              search: { task: record.taskId as string },
            })
          }
        >
          Open
        </Button>
      )}
    </li>
  );
}
