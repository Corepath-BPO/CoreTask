import type { AutomationGraphIssue } from '@coretask/types';
import { AlertTriangle, Info } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * What is wrong, and where.
 *
 * Shown only when there is something to say. A permanent panel explaining that
 * a rule is incomplete is one people stop reading, and then stop seeing when it
 * finally matters.
 *
 * Each issue that names a node is a button. "Add at least one action" is easy
 * to act on; "this step follows something that is no longer here" is not,
 * unless the thing it is about can be found by pressing it.
 */
export function AutomationValidationBanner({
  issues,
  onFocusNode,
}: {
  issues: AutomationGraphIssue[];
  onFocusNode: (nodeId: string) => void;
}) {
  const errors = issues.filter((issue) => issue.level === 'ERROR');
  const warnings = issues.filter((issue) => issue.level === 'WARNING');

  if (errors.length === 0 && warnings.length === 0) return null;

  const blocking = errors.length > 0;

  return (
    <div
      // Polite rather than assertive: this updates as somebody types, and an
      // assertive region would interrupt them mid-word on every keystroke.
      role="status"
      aria-live="polite"
      className={cn(
        'my-3 rounded-lg border px-4 py-3 text-sm',
        blocking ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5',
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        {blocking ? (
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
        ) : (
          <Info className="size-4 text-warning" aria-hidden="true" />
        )}
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
                onClick={() => onFocusNode(issue.nodeId as string)}
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
    </div>
  );
}
