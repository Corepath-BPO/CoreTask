import type { AutomationRuleVersionSummary } from '@coretask/types';
import { History, RotateCcw } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';

import { useRuleVersions } from '../../hooks/use-automations';

/**
 * The versions a rule has published, and the way back to one.
 *
 * Restoring puts a version's steps in the draft, not live: the canvas shows
 * them and Publish makes them run, validated against the project as it is now
 * — the section an old version moved tasks into may have gone since. The
 * version running is listed first among equals and cannot be restored onto
 * itself, except as "discard what I have not published", which is the same act.
 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  ruleId,
  ruleName,
  hasUnpublishedChanges,
  restoring,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  projectId: string;
  ruleId: string;
  /** What the rule is called now. */
  ruleName: string;
  /** Whether the draft — saved or still on screen — differs from what runs. */
  hasUnpublishedChanges: boolean;
  restoring: boolean;
  onRestore: (version: AutomationRuleVersionSummary) => Promise<void>;
}) {
  const versions = useRuleVersions(workspaceId, projectId, ruleId, open);
  /** The version waiting on "this replaces your unpublished changes". */
  const [confirming, setConfirming] = useState<AutomationRuleVersionSummary | null>(null);
  const running = versions.data?.find((version) => version.isPublished) ?? null;

  const restore = (version: AutomationRuleVersionSummary) => {
    // Nothing would be lost: the draft already says what is running.
    if (!hasUnpublishedChanges) {
      void onRestore(version);
      return;
    }
    setConfirming(version);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-primary-strong" aria-hidden="true" />
              Version history
            </DialogTitle>
            <DialogDescription>
              Each publish is a version. The rule runs the newest one until you publish again.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
            {hasUnpublishedChanges && running && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5">
                <p className="text-sm">The draft has changes that are not running yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 cursor-pointer"
                  disabled={restoring}
                  onClick={() => restore(running)}
                >
                  Discard changes
                </Button>
              </div>
            )}

            {versions.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : versions.isError ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                The history could not be loaded. Close this and try again.
              </p>
            ) : (versions.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                This rule has not been published yet, so it has no versions.
              </p>
            ) : (
              <ol className="space-y-2">
                {(versions.data ?? []).map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        Version {version.version}
                        {version.isPublished && <Badge variant="success">Running</Badge>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        Published {formatRelativeTime(version.publishedAt)}
                        {version.publishedBy ? ` by ${version.publishedBy.name}` : ''} ·{' '}
                        {version.stepCount} {version.stepCount === 1 ? 'step' : 'steps'}
                        {/* Only a name the rule no longer has says anything. */}
                        {version.name && version.name !== ruleName ? ` · as “${version.name}”` : ''}
                      </p>
                    </div>

                    {!version.isPublished && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 cursor-pointer"
                        aria-label={`Restore version ${version.version}`}
                        disabled={restoring}
                        onClick={() => restore(version)}
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.isPublished
                ? 'Discard your unpublished changes?'
                : `Restore version ${confirming?.version ?? ''}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.isPublished
                ? 'The draft goes back to the version that is running. Nothing running changes.'
                : 'Its steps replace the changes you have not published. Nothing running changes until you publish.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const version = confirming;
                setConfirming(null);
                if (version) void onRestore(version);
              }}
            >
              {confirming?.isPublished ? 'Discard changes' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
