import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus goes into the panel, and comes back out where it came from.
 *
 * Without this the panel opened behind the keyboard: clicking a card left focus
 * on the card, so the form on screen could only be reached by tabbing through
 * the whole rule first, and a screen reader was never told a panel had appeared
 * at all.
 *
 * `subject` is whatever the panel is currently about — a node id, or the mode
 * when it is not about one node. Choosing an action swaps the catalogue for that
 * step's form, which takes the search box, and the focus in it, out of the
 * document; the browser drops focus on `<body>`, where the next Tab starts again
 * from the top of the page. Watching the subject is what catches that.
 */
export function useRailFocus(panel: RefObject<HTMLElement | null>, open: boolean, subject: string) {
  useEffect(() => {
    if (!open) return;

    // Whatever opened it — usually the card on the canvas — gets focus back.
    const opener = document.activeElement;

    /*
     * A frame late, deliberately.
     *
     * The catalogue focuses its own search box as it mounts. Taking focus at
     * commit time would win that race and move the cursor out of the field
     * somebody is about to type in, so this looks at where focus actually
     * settled and only steps in if nothing inside the panel wanted it.
     */
    const frame = requestAnimationFrame(() => {
      const element = panel.current;
      if (element && !element.contains(document.activeElement)) {
        element.focus({ preventScroll: true });
      }
    });

    return () => {
      cancelAnimationFrame(frame);

      /*
       * Only if it is still on screen. The panel very often closes *because*
       * the step it was showing was deleted, and that card went with it —
       * focusing a detached element silently drops focus onto `<body>`, which
       * is the failure this whole hook exists to prevent.
       */
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [panel, open]);

  useEffect(() => {
    const element = panel.current;
    if (!open || !element) return;

    // Only when the last thing focused has been unmounted from under it.
    if (document.activeElement !== document.body) return;

    element.focus({ preventScroll: true });
  }, [panel, open, subject]);
}

/**
 * Escape closes the panel rather than the whole builder.
 *
 * The rail lives inside a dialog that fills the screen, and that dialog treats
 * Escape as "leave the builder" — so dismissing a settings panel offered to
 * discard the rule, or on a saved one simply navigated away from it. Two very
 * different sizes of action behind one key.
 *
 * Registered on `window` rather than `document`, because the dialog's own
 * handler captures on `document` and capture runs outermost first: anything
 * registered on `document` would be a frame too late to stop it.
 *
 * A select, a menu or a nested dialog renders in its own portal outside this
 * one, so an Escape aimed at those never reaches here — which is the point.
 * They own the key while they are open, or they could never be closed on their
 * own.
 */
export function useRailDismiss(
  panel: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  /*
   * Held in a ref rather than closed over.
   *
   * The callback is rebuilt on every render of the builder, which happens on
   * every keystroke typed into a field, and naming it as a dependency would
   * tear down and re-attach a window listener each time.
   */
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      /*
       * Only for keys pressed inside the surface the panel belongs to. With no
       * dialog around it the rail leaves Escape alone, which is the safe way
       * round: taking a key nobody asked for is worse than not taking it.
       */
      const surface = panel.current?.closest('[role="dialog"]');
      if (!surface || !(event.target instanceof Node) || !surface.contains(event.target)) return;

      event.stopPropagation();
      close.current();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [panel, open]);
}
