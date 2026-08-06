/**
 * Recognising your own write when it comes back over the socket.
 *
 * Every mutation sends a correlation id; the server echoes it on the event it
 * broadcasts. A client that finds its own id in the ring below knows the change
 * is already in its cache and skips the refetch — without that, the round trip
 * is: mutate, invalidate, refetch, then the socket arrives and invalidates
 * again, so every edit costs two requests and the grid flickers between them.
 *
 * A bounded ring rather than a growing set. Ids are only interesting for the
 * moment between the response and the broadcast, and a set that only ever grows
 * is a leak in a tab somebody leaves open all week.
 */
const CAPACITY = 64;

const recent: string[] = [];

export function nextCorrelationId(): string {
  const id = crypto.randomUUID();

  recent.push(id);
  if (recent.length > CAPACITY) recent.shift();

  return id;
}

/**
 * Whether this client sent it.
 *
 * Deliberately non-destructive: the same correlation id can arrive more than
 * once — a create emits both `work-item:created` and the legacy `task:created`
 * — and consuming it on the first would leave the second looking like somebody
 * else's change.
 */
export function isOwnChange(correlationId: string | undefined): boolean {
  return correlationId !== undefined && recent.includes(correlationId);
}

/** Test seam. Nothing in the app clears this; a tab's history is its own. */
export function resetCorrelationIds(): void {
  recent.length = 0;
}
