import {
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TicketStatus,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { TicketDetail, UpdateTicketPayload } from '@coretask/types';

import { TicketPriorityBadge, TicketStatusBadge } from '@/components/data-display/status-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { useWorkspaceMembers } from '@/features/workspaces/hooks/use-workspaces';
import {
  cn,
  formatDate,
  formatDueDate,
  formatRelativeTime,
  humanizeEnum,
  initials,
} from '@/lib/utils';

import { useTicketDetail, useUpdateTicket } from '../hooks/use-tickets';

interface TicketDetailDialogProps {
  workspaceId: string | undefined;
  /** A UUID or a key such as `CORE-1001`. Null closes the dialog. */
  idOrKey: string | null;
  onClose: () => void;
  role: WorkspaceRole;
}

const NONE = '__none__';

export function TicketDetailDialog({
  workspaceId,
  idOrKey,
  onClose,
  role,
}: TicketDetailDialogProps) {
  const { data: ticket, isLoading, isError } = useTicketDetail(workspaceId, idOrKey);

  return (
    <Dialog open={idOrKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {isLoading && <TicketDetailSkeleton />}

        {isError && (
          <>
            <DialogHeader>
              <DialogTitle>Ticket unavailable</DialogTitle>
              <DialogDescription>
                It may have been moved, or you may not have access to it.
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {ticket && (
          // Remounting on identity change resets every uncontrolled child, so
          // opening a second ticket cannot inherit the first one's state.
          <TicketDetailBody key={ticket.id} ticket={ticket} workspaceId={workspaceId} role={role} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TicketDetailBody({
  ticket,
  workspaceId,
  role,
}: {
  ticket: TicketDetail;
  workspaceId: string | undefined;
  role: WorkspaceRole;
}) {
  const updateTicket = useUpdateTicket(workspaceId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: projects } = useProjects(workspaceId, { limit: 100 });

  const canEdit = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const busy = updateTicket.isPending;
  const closed = ticket.status === TicketStatus.CLOSED;

  const patch = (payload: UpdateTicketPayload) =>
    updateTicket.mutate({ idOrKey: ticket.id, payload });

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {ticket.key}
          </Badge>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </div>
        <DialogTitle className="text-left">{ticket.title}</DialogTitle>
        <DialogDescription className="text-left">
          Reported by {ticket.reporter?.name ?? 'someone since removed'}{' '}
          {formatRelativeTime(ticket.createdAt)}
          {ticket.project ? ` · ${ticket.project.key}` : ''}
        </DialogDescription>
      </DialogHeader>

      {ticket.description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ticket.description}</p>
      )}

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Status">
          <Select
            value={ticket.status}
            onValueChange={(status) => patch({ status: status as TicketDetail['status'] })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger aria-label="Ticket status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {humanizeEnum(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Assignee">
          <Select
            value={ticket.assigneeId ?? NONE}
            onValueChange={(value) => patch({ assigneeId: value === NONE ? null : value })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger aria-label="Ticket assignee" className="w-full">
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
        </FieldRow>

        <FieldRow label="Priority">
          <Select
            value={ticket.priority}
            onValueChange={(value) => patch({ priority: value as TicketDetail['priority'] })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger aria-label="Ticket priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_PRIORITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {humanizeEnum(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Severity">
          <Select
            value={ticket.severity}
            onValueChange={(value) => patch({ severity: value as TicketDetail['severity'] })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger aria-label="Ticket severity" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_SEVERITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {humanizeEnum(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Type">
          <Select
            value={ticket.type}
            onValueChange={(value) => patch({ type: value as TicketDetail['type'] })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger aria-label="Ticket type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {humanizeEnum(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow label="Project">
          <Select
            value={ticket.projectId ?? NONE}
            onValueChange={(value) => patch({ projectId: value === NONE ? null : value })}
            disabled={!canEdit || busy}
          >
            <SelectTrigger aria-label="Ticket project" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No project</SelectItem>
              {(projects?.items ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.key} · {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </div>

      <Separator />

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Meta label="Assignee">
          {ticket.assignee ? (
            <span className="inline-flex items-center gap-2">
              <Avatar className="size-5">
                {ticket.assignee.avatarUrl && (
                  <AvatarImage src={ticket.assignee.avatarUrl} alt="" />
                )}
                <AvatarFallback className="text-[9px]">
                  {initials(ticket.assignee.name)}
                </AvatarFallback>
              </Avatar>
              {ticket.assignee.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </Meta>

        <Meta label="Due">
          {ticket.dueDate ? (
            <span
              className={cn(
                // A finished ticket is not late; show the date, not a countdown.
                !closed &&
                  ticket.status !== TicketStatus.RESOLVED &&
                  new Date(ticket.dueDate) < new Date() &&
                  'font-medium text-destructive',
              )}
            >
              {closed || ticket.status === TicketStatus.RESOLVED
                ? formatDate(ticket.dueDate)
                : formatDueDate(ticket.dueDate)}
            </span>
          ) : (
            <span className="text-muted-foreground">No due date</span>
          )}
        </Meta>

        {ticket.resolvedAt && <Meta label="Resolved">{formatRelativeTime(ticket.resolvedAt)}</Meta>}
        {ticket.closedAt && <Meta label="Closed">{formatRelativeTime(ticket.closedAt)}</Meta>}
        <Meta label="Last updated">{formatRelativeTime(ticket.updatedAt)}</Meta>
      </dl>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Your role in this workspace is read-only for tickets.
        </p>
      )}
    </>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 sm:justify-start sm:gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function TicketDetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading ticket</span>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
    </div>
  );
}
