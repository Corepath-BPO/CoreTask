import { useEffect, useRef } from 'react';

/**
 * Focus follows the panel: in when it opens, back to the opener on close.
 *
 * The panel is always mounted behind `inert`, so this is a plain open-edge
 * effect — see `useRailFocus` in the automation builder for the pattern.
 * Applying `inert` on close has already pushed any panel focus onto <body>
 * before this runs, which is the test for "was focus ours to give back": if
 * Escape was pressed while working in the list, the active element is still
 * out there and must be left alone.
 */
export function usePanelFocus(panel: React.RefObject<HTMLElement | null>, open: boolean) {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    if (open) {
      // The row button that opened the panel still holds focus at commit time.
      opener.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
      element.focus({ preventScroll: true });
      return;
    }

    const previous = opener.current;
    opener.current = null;
    // Only if the opener is still on screen: a re-render reuses the row's DOM
    // node, but a refetch or a tab switch may have unmounted it.
    if (previous?.isConnected && document.activeElement === document.body) {
      previous.focus({ preventScroll: true });
    }
  }, [panel, open]);
}
