import type { AutomationGraphIssue } from '@coretask/types';
import { AlertTriangle, Info } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * What is wrong, beside the button it is stopping.
 *
 * This was a full-width banner between the chrome and the canvas, which spent a
 * block of height on a list that is usually one line long — and pushed the rule
 * down the screen every time somebody deleted a step, so the drawing moved for
 * reasons that had nothing to do with the drawing. A count next to Publish says
 * the same thing where it is actually being asked: the button is off, and this
 * is why.
 *
 * Shown whenever there is anything to say, including on a rule nobody has
 * finished. The banner used to stay quiet until the first edit, because opening
 * a blank canvas to a list of everything missing reads as a telling-off — but
 * that left Publish disabled with nothing beside it, which is a dead end. A
 * count is quiet enough to be an answer rather than a lecture; the list itself
 * stays behind a click.
 *
 * Each issue that names a node is a button. "Add at least one action" is easy
 * to act on; "this step follows something that is no longer here" is not,
 * unless the thing it is about can be found by pressing it.
 */
export function AutomationValidationIssues({
  issues,
  onFocusNode,
}: {
  issues: AutomationGraphIssue[];
  onFocusNode: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const errors = issues.filter((issue) => issue.level === 'ERROR');
  const warnings = issues.filter((issue) => issue.level === 'WARNING');

  if (errors.length === 0 && warnings.length === 0) return null;

  const blocking = errors.length > 0;
  const count = errors.length + warnings.length;

  return (
    /*
     * The live region is the count, not the list.
     *
     * The list only exists while the popover is open, so announcing from inside
     * it would say nothing during the typing that changes it. Polite rather than
     * assertive: this updates on every keystroke, and an assertive region would
     * interrupt somebody mid-word.
     */
    <span role="status" aria-live="polite" className="flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'cursor-pointer gap-1.5',
              blocking
                ? 'text-destructive hover:text-destructive'
                : 'text-warning hover:text-warning',
            )}
          >
            {blocking ? (
              <AlertTriangle className="size-4" aria-hidden="true" />
            ) : (
              <Info className="size-4" aria-hidden="true" />
            )}
            {count === 1 ? '1 problem' : `${count} problems`}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-3 text-sm">
          <p className="font-medium">
            {blocking ? 'This rule cannot be published yet' : 'Worth knowing'}
          </p>

          <ul className="mt-2 space-y-1">
            {[...errors, ...warnings].map((issue, index) => (
              <li key={`${issue.nodeId ?? 'rule'}-${index}`} className="flex gap-2">
                <span aria-hidden="true" className="text-muted-foreground">
                  •
                </span>

                {issue.nodeId ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Closed on the way out: the step this selects sits under
                      // the popover, so leaving it open hides what was asked for.
                      setOpen(false);
                      onFocusNode(issue.nodeId as string);
                    }}
                    className="cursor-pointer text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    {issue.message}
                  </button>
                ) : (
                  <span>{issue.message}</span>
                )}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </span>
  );
}
