import type { Portfolio } from '@coretask/types';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ProjectStatusUpdateValue } from '@/features/projects/hooks/use-project-updates';
import { cn, formatDate } from '@/lib/utils';

import { usePostPortfolioStatus } from '../hooks/use-portfolio-status';
import { STATUS_UPDATE_OPTIONS } from '../lib/status-updates';
import { StatusUpdateChip } from './status-update';

interface PortfolioStatusDialogProps {
  workspaceId: string;
  portfolio: Pick<Portfolio, 'id' | 'name'>;
  /** The status picked from the menu; null while closed. */
  initialStatus: ProjectStatusUpdateValue | null;
  onClose: () => void;
}

/**
 * Setting a portfolio's status: where it stands, a summary and what comes
 * next, posted so its owner and everyone who starred it hear about it.
 */
export function PortfolioStatusDialog({
  workspaceId,
  portfolio,
  initialStatus,
  onClose,
}: PortfolioStatusDialogProps) {
  return (
    <Dialog open={initialStatus !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set the status of {portfolio.name}</DialogTitle>
          <DialogDescription>
            How the portfolio as a whole is going. Its owner and everyone who starred it are told.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, so each starts afresh on the status picked. */}
        {initialStatus && (
          <StatusForm
            workspaceId={workspaceId}
            portfolio={portfolio}
            initialStatus={initialStatus}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusForm({
  workspaceId,
  portfolio,
  initialStatus,
  onClose,
}: Omit<PortfolioStatusDialogProps, 'initialStatus'> & {
  initialStatus: ProjectStatusUpdateValue;
}) {
  const post = usePostPortfolioStatus(workspaceId, portfolio.id);
  const [status, setStatus] = useState<ProjectStatusUpdateValue>(initialStatus);
  const [title, setTitle] = useState(`${portfolio.name} - ${formatDate(new Date())}`);
  const [summary, setSummary] = useState('');
  const [nextSteps, setNextSteps] = useState('');

  const submit = () =>
    post.mutate({ status, title: title.trim(), summary, nextSteps }, { onSuccess: onClose });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) submit();
      }}
    >
      <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
        {STATUS_UPDATE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={status === option.value}
            onClick={() => setStatus(option.value)}
            className={cn(
              'rounded-full p-0.5 transition-shadow',
              status === option.value ? 'ring-2 ring-ring' : 'opacity-70 hover:opacity-100',
            )}
          >
            <StatusUpdateChip status={option.value} />
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portfolio-status-title">Title</Label>
        <Input
          id="portfolio-status-title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portfolio-status-summary">Summary</Label>
        <Textarea
          id="portfolio-status-summary"
          rows={3}
          value={summary}
          placeholder="Where things stand across these projects."
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portfolio-status-next">Next steps</Label>
        <Textarea
          id="portfolio-status-next"
          rows={2}
          value={nextSteps}
          onChange={(event) => setNextSteps(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim() || post.isPending}>
          Post status
        </Button>
      </DialogFooter>
    </form>
  );
}
