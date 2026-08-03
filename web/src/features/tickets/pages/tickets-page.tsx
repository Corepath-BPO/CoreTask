import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TicketStatus,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { Ticket } from '@coretask/types';
import { Plus, Search, Ticket as TicketIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/data-display/stat-card';
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/data-display/status-badge';
import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import {
  cn,
  formatDate,
  formatDueDate,
  formatRelativeTime,
  humanizeEnum,
  initials,
} from '@/lib/utils';

import { TicketDetailDialog } from '../components/ticket-detail-dialog';
import { TicketFormDialog } from '../components/ticket-form-dialog';
import { useTickets } from '../hooks/use-tickets';
import {
  ALL_STATUSES as ALL,
  buildTicketParams,
  OPEN_ONLY,
  type TicketScope,
} from '../lib/build-ticket-params';

const PAGE_SIZE = 25;

export function TicketsPage() {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const [scope, setScope] = useState<TicketScope>('all');
  const [statusFilter, setStatusFilter] = useState<string>(OPEN_ONLY);
  const [type, setType] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  /** Filters reset paging where they change, not in an effect reacting to them. */
  const applyFilter =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const params = useMemo(
    () =>
      buildTicketParams({
        page,
        limit: PAGE_SIZE,
        scope,
        status: statusFilter,
        type,
        priority,
        search: debouncedSearch,
      }),
    [page, scope, statusFilter, type, priority, debouncedSearch],
  );

  const { data, isLoading, isError, error } = useTickets(workspaceId, params);

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canReport = hasAtLeastRole(role, WorkspaceRole.MEMBER);
  const tickets = data?.items ?? [];
  const meta = data?.meta;
  const summary = meta?.summary;

  if (workspaceLoading) return <TicketsSkeleton />;

  if (!workspace) {
    return (
      <EmptyState
        icon={TicketIcon}
        title="No workspace yet"
        description="Create a workspace before reporting tickets."
        className="mt-10"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets"
        description={`Bug reports, requests and incidents across ${workspace.name}.`}
        actions={
          canReport ? (
            <Button onClick={() => setReporting(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Report ticket
            </Button>
          ) : undefined
        }
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Open" value={summary.open} hint={`${summary.total} all time`} />
          <StatCard label="Urgent" value={summary.urgent} invertDelta />
          <StatCard label="Unassigned" value={summary.unassigned} invertDelta />
          <StatCard label="Overdue" value={summary.overdue} invertDelta />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => applyFilter(setSearch)(event.target.value)}
            placeholder="Search titles, or paste CORE-1001…"
            aria-label="Search tickets"
            className="pl-9"
          />
        </div>

        <Select
          value={scope}
          onValueChange={(value) => applyFilter(setScope)(value as typeof scope)}
        >
          <SelectTrigger aria-label="Filter by person" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="reported">Reported by me</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={applyFilter(setStatusFilter)}>
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPEN_ONLY}>Open only</SelectItem>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TICKET_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={applyFilter(setType)}>
          <SelectTrigger aria-label="Filter by type" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any type</SelectItem>
            {TICKET_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={applyFilter(setPriority)}>
          <SelectTrigger aria-label="Filter by priority" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any priority</SelectItem>
            {TICKET_PRIORITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load tickets.'}
          </CardContent>
        </Card>
      )}

      {isLoading && <TicketRowsSkeleton />}

      {!isLoading && !isError && tickets.length === 0 && (
        <EmptyState
          icon={TicketIcon}
          title="No tickets match those filters"
          description="Try a different search term, or widen the filters."
        />
      )}

      {tickets.length > 0 && (
        <Card>
          <CardContent className="px-0 py-0">
            <ul className="divide-y">
              {tickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} onOpen={setOpenTicket} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} of {meta.totalPages} · {meta.total} tickets
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <TicketFormDialog open={reporting} onOpenChange={setReporting} workspaceId={workspaceId} />

      <TicketDetailDialog
        workspaceId={workspaceId}
        idOrKey={openTicket}
        onClose={() => setOpenTicket(null)}
        role={role}
      />
    </div>
  );
}

function TicketRow({ ticket, onOpen }: { ticket: Ticket; onOpen: (id: string) => void }) {
  const finished = ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED;
  const overdue = ticket.dueDate !== null && !finished && new Date(ticket.dueDate) < new Date();

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(ticket.id)}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <Badge variant="outline" className="shrink-0 font-mono text-[11px]">
          {ticket.key}
        </Badge>

        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-medium', finished && 'text-muted-foreground')}>
            {ticket.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {humanizeEnum(ticket.type)} · updated {formatRelativeTime(ticket.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <TicketPriorityBadge priority={ticket.priority} />
          <TicketStatusBadge status={ticket.status} />
          {ticket.dueDate && (
            <span
              className={cn(
                'w-20 text-right text-xs tabular-nums',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {/* A resolved ticket is not late; show the date, not a countdown. */}
              {finished ? formatDate(ticket.dueDate) : formatDueDate(ticket.dueDate)}
            </span>
          )}
          {ticket.assignee ? (
            <Avatar className="size-6" title={ticket.assignee.name}>
              {ticket.assignee.avatarUrl && <AvatarImage src={ticket.assignee.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">
                {initials(ticket.assignee.name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Badge variant="muted" className="text-[10px]">
              Unassigned
            </Badge>
          )}
        </div>
      </button>
    </li>
  );
}

function TicketsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading tickets</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <TicketRowsSkeleton />
    </div>
  );
}

function TicketRowsSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
