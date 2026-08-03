import { arrayMove } from '@dnd-kit/sortable';
import type { Section } from '@coretask/types';

export interface DropPlan {
  /** The list in its new order, for the optimistic update. */
  reordered: Section[];
  /** Sibling the dragged section now sits after; `null` when it landed first. */
  afterSectionId: string | null;
}

/**
 * Translates a dnd-kit drop into the API's relative-position contract.
 *
 * dnd-kit reports "item A was dropped onto item B"; the API positions relative
 * to the sibling on the *left*. Getting that conversion wrong is an off-by-one
 * that only shows up when dragging in one particular direction, so it lives
 * here as a pure function rather than inline in the drag handler.
 *
 * Returns `null` when the drop is a no-op.
 */
export function resolveDropPlan(
  sections: Section[],
  activeId: string,
  overId: string,
): DropPlan | null {
  if (activeId === overId) return null;

  const from = sections.findIndex((section) => section.id === activeId);
  const to = sections.findIndex((section) => section.id === overId);
  if (from === -1 || to === -1) return null;

  const reordered = arrayMove(sections, from, to);
  const index = reordered.findIndex((section) => section.id === activeId);

  return {
    reordered,
    afterSectionId: index <= 0 ? null : (reordered[index - 1]?.id ?? null),
  };
}
