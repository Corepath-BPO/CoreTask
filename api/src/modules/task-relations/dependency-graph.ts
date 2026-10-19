/**
 * Whether "`blocked` waits on `blocking`" would close a loop.
 *
 * It would if `blocking` already waits on `blocked`, directly or through any
 * chain — then every task in the ring is waiting for another one in it and
 * none can ever start. Walks outward from `blocking` along what each task
 * waits on, one level at a time; `waitsOn` answers a level in one call, so a
 * database-backed caller makes one query per hop rather than per task.
 */
export async function wouldCloseLoop(
  blocked: string,
  blocking: string,
  waitsOn: (taskIds: string[]) => Promise<Map<string, string[]>>,
): Promise<boolean> {
  if (blocked === blocking) return true;

  const seen = new Set<string>([blocking]);
  let frontier = [blocking];

  while (frontier.length > 0) {
    const next: string[] = [];
    const edges = await waitsOn(frontier);

    for (const targets of edges.values()) {
      for (const target of targets) {
        if (target === blocked) return true;
        if (!seen.has(target)) {
          seen.add(target);
          next.push(target);
        }
      }
    }

    frontier = next;
  }

  return false;
}
