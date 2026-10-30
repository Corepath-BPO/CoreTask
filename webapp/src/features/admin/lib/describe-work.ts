/** "3 tasks and 1 ticket", or null when there is nothing. */
export function describeWork(tasks: number, tickets: number): string | null {
  const parts = [
    tasks > 0 ? `${tasks} task${tasks === 1 ? '' : 's'}` : null,
    tickets > 0 ? `${tickets} ticket${tickets === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' and ') : null;
}
