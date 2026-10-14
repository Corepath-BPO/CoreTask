import { TicketStatus } from '@coretask/contracts';

/**
 * `resolvedAt` / `closedAt` derived from status rather than settable.
 *
 * Closing implies resolution, so a ticket closed without passing through
 * RESOLVED still gets a resolution timestamp — otherwise "time to resolve"
 * reporting would silently miss those. Shared by the tickets service and the
 * rules that set a ticket's status, so both stamp alike.
 */
export function ticketLifecycle(
  status: string,
  resolvedAt: Date | null,
  closedAt: Date | null,
  now: Date = new Date(),
): { resolvedAt: Date | null; closedAt: Date | null } {
  if (status === TicketStatus.CLOSED) {
    return { resolvedAt: resolvedAt ?? now, closedAt: closedAt ?? now };
  }
  if (status === TicketStatus.RESOLVED) {
    return { resolvedAt: resolvedAt ?? now, closedAt: null };
  }
  // Reopened: the ticket is live again, so neither timestamp applies.
  return { resolvedAt: null, closedAt: null };
}
