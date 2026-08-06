import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

import { AutomationBuilderPage } from './automation-builder-page';

/**
 * The builder, over the whole screen.
 *
 * It used to render as the body of the Automations tab, which meant the canvas
 * got whatever was left after the project header, the tab row, its own toolbar
 * and the validation banner — on a laptop the rule ended up in a strip at the
 * bottom of the page, and a workflow is the one thing that cannot be read in a
 * strip. A rule is also a thing somebody sits down to write; the surrounding
 * project chrome is not context for that, it is competition for it.
 *
 * The address stays. A rule keeps its own URL and this is layered over it, so it
 * can still be linked to and reloaded — the dialog is how it looks, not what it
 * is. That is also why closing navigates rather than flipping a boolean: the URL
 * is the state, and leaving it pointing at a builder nobody can see would make
 * the back button lie.
 */
export function AutomationBuilderDialog({
  projectId,
  ruleId,
  sectionId,
}: {
  projectId: string;
  ruleId: string | null;
  sectionId?: string;
}) {
  const navigate = useNavigate();

  /*
   * Set by the builder whenever it holds unsaved work.
   *
   * Making this a modal introduced a way to lose a rule that did not exist
   * before: Escape and a click on the backdrop are both easy to hit by accident,
   * and neither used to do anything. So the two casual dismissals ask first,
   * while the explicit Close button is taken at its word.
   */
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const leave = () =>
    void navigate({ to: '/projects/$projectId/automations', params: { projectId }, search: {} });

  const tryLeave = () => {
    if (dirty) {
      setConfirming(true);
      return;
    }

    leave();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && tryLeave()}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        // Both routed through the same question, rather than dismissing.
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          tryLeave();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        {/* Radix requires a title for the dialog to be announced; the visible
            one is the rule-name field, which is editable and cannot be it. */}
        <DialogTitle className="sr-only">Rule builder</DialogTitle>

        <AutomationBuilderPage
          projectId={projectId}
          ruleId={ruleId}
          {...(sectionId ? { sectionId } : {})}
          onDirtyChange={setDirty}
          onClose={leave}
        />
      </DialogContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              This rule has changes that have not been saved. Closing now discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={leave}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
