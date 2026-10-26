import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A place on the tab row for the controls belonging to whichever view is open.
 *
 * The tabs are owned by the project page and the search box by the view inside
 * it, so putting them on one line means one of them has to reach across that
 * boundary. Lifting the search state up to the page would be the wrong way
 * round — the page would then hold state it has no use for, and every future
 * view would add another field to it.
 *
 * So the page offers a slot and the view fills it. What renders stays with the
 * view that owns its state; only *where* it renders comes from the page.
 *
 * Three pieces rather than one, because the slot sits on the tab row while the
 * views that fill it render further down the page — the provider has to span
 * both, so it cannot be the thing that draws the row.
 *
 * With no provider above it, `ViewToolbar` renders its children where they
 * stand. A view is never broken by being used on a page that has no slot.
 */
const SlotContext = createContext<{
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
}>({ node: null, setNode: () => {} });

export function ViewToolbarProvider({ children }: { children: ReactNode }) {
  // State, not a ref: the portal target has to trigger a re-render when it
  // arrives, and a ref assignment on its own does not.
  const [node, setNode] = useState<HTMLElement | null>(null);

  return <SlotContext.Provider value={{ node, setNode }}>{children}</SlotContext.Provider>;
}

/** Where the open view's controls appear. Belongs on the tab row. */
export function ViewToolbarSlot() {
  const { setNode } = useContext(SlotContext);

  return <div ref={setNode} className="flex items-center gap-2" />;
}

/** Renders `children` into the tab row's slot, or in place if there is none. */
export function ViewToolbar({ children }: { children: ReactNode }) {
  const { node } = useContext(SlotContext);

  return node ? createPortal(children, node) : <>{children}</>;
}
