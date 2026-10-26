import { Fragment } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { SHORTCUT_GROUPS } from '@/lib/shortcuts/shortcut-definitions';
import { useUiStore } from '@/stores/ui.store';

/**
 * Asana's shortcut sheet: two columns of "what" on the left and keys on the
 * right. Opened by `?` and from the account menu; the store holds the flag
 * because both openers live in different corners of the shell.
 */
export function ShortcutsHelpDialog() {
  const open = useUiStore((state) => state.shortcutsHelpOpen);
  const setOpen = useUiStore((state) => state.setShortcutsHelpOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Hold Tab and press a key, the way Asana's chords work.
        </DialogDescription>

        <div className="grid gap-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="divide-y divide-border/60">
                {group.items.map((item) => (
                  <div
                    key={item.description}
                    className="flex items-center justify-between gap-4 py-1.5 text-sm"
                  >
                    <dt>{item.description}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key, index) => (
                        <Fragment key={key}>
                          {index > 0 && (
                            <span className="text-xs text-muted-foreground" aria-hidden="true">
                              +
                            </span>
                          )}
                          <Kbd>{key}</Kbd>
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
