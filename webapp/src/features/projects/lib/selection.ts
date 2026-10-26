import type { Group } from './group-by-section';

/**
 * Multi-select in the List, as Asana does it: click a row to select it,
 * shift-click to extend to a range, ctrl/cmd-click to add or remove one.
 *
 * Pure functions over ids, so the rules can be tested without a table. The
 * view owns the set and the anchor; these decide what the next set is.
 */

/**
 * Top-level rows in the order they are drawn, skipping collapsed sections.
 *
 * A shift range runs over what the reader can see: rows hidden inside a
 * collapsed section are not "between" two visible ones, and subtasks never
 * take part — they belong to their parent.
 */
export function visibleOrder(groups: readonly Group[], collapsed: ReadonlySet<string>): string[] {
  const order: string[] = [];
  for (const group of groups) {
    if (collapsed.has(group.id)) continue;
    for (const task of group.tasks) order.push(task.id);
  }
  return order;
}

/**
 * Every id from the anchor to the target, inclusive, whichever way round.
 *
 * Without an anchor — or with one that has since scrolled out of the data —
 * the range is just the target, which is what a first click means.
 */
export function rangeBetween(
  order: readonly string[],
  anchor: string | null,
  target: string,
): string[] {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from === -1 || to === -1) return [target];

  const [start, end] = from <= to ? [from, to] : [to, from];
  return order.slice(start, end + 1);
}

/** The set with `id` added if absent, removed if present. Never mutates. */
export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const INTERACTIVE =
  'button, a, input, select, textarea, [role="button"], [role="option"], [contenteditable]';

/**
 * Whether a click landed on a control rather than on the row.
 *
 * A row is covered in controls — the title opens the task, every cell edits —
 * and each of those already means something. Only a click on the row's own
 * padding is a click on the row.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

const ESCAPE_OWNED =
  'input:not([type="checkbox"]), textarea, [contenteditable], [role="textbox"], [role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]';

/**
 * Whether an Escape pressed here is already somebody else's: a field being
 * edited, or an open picker or dialog. The selection clears on Escape only
 * when nothing nearer has a claim on it.
 */
export function escapeBelongsElsewhere(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ESCAPE_OWNED) !== null;
}
