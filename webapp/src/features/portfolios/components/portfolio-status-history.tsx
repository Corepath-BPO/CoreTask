import type { PortfolioStatusUpdate } from '@coretask/types';
import { Trash2 } from 'lucide-react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ProjectStatusUpdateValue } from '@/features/projects/hooks/use-project-updates';
import { formatRelativeTime } from '@/lib/utils';

import { useDeletePortfolioStatus, usePortfolioStatusUpdates } from '../hooks/use-portfolio-status';
import { StatusUpdateChip } from './status-update';

interface PortfolioStatusHistoryProps {
  workspaceId: string;
  portfolioId: string;
  /** Who may delete an update: its author, or a manager. */
  canDelete: (update: PortfolioStatusUpdate) => boolean;
}

const statusValue = (update: PortfolioStatusUpdate) =>
  update.status.toLowerCase() as ProjectStatusUpdateValue;

/** The portfolio's own status updates, newest first, on its Progress tab. */
export function PortfolioStatusHistory({
  workspaceId,
  portfolioId,
  canDelete,
}: PortfolioStatusHistoryProps) {
  const { data: updates } = usePortfolioStatusUpdates(workspaceId, portfolioId);
  const remove = useDeletePortfolioStatus(workspaceId, portfolioId);
  if (!updates || updates.length === 0) return null;
  const [latest, ...earlier] = updates;

  const entry = (update: PortfolioStatusUpdate, prominent: boolean) => (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusUpdateChip status={statusValue(update)} />
        <span className={prominent ? 'font-medium' : 'text-sm font-medium'}>{update.title}</span>
        {canDelete(update) && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={`Delete “${update.title}”`}
            onClick={() => remove.mutate(update.id)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {update.summary && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{update.summary}</p>
      )}
      {update.nextSteps && (
        <p className="whitespace-pre-wrap text-sm">
          <span className="font-medium">Next: </span>
          <span className="text-muted-foreground">{update.nextSteps}</span>
        </p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {update.author && (
          <PersonAvatar
            name={update.author.name}
            avatarUrl={update.author.avatarUrl}
            className="size-4"
            fallbackClassName="text-[7px]"
          />
        )}
        {update.author?.name ?? 'Someone'} · {formatRelativeTime(update.createdAt)}
      </p>
    </div>
  );

  return (
    <section aria-label="Portfolio status" className="space-y-2">
      <h2 className="text-sm font-semibold">Portfolio status</h2>
      <Card>
        <CardContent className="py-4">{entry(latest, true)}</CardContent>
      </Card>
      {earlier.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {earlier.length} earlier {earlier.length === 1 ? 'update' : 'updates'}
          </summary>
          <ul className="mt-2 space-y-3 border-l pl-4">
            {earlier.map((update) => (
              <li key={update.id}>{entry(update, false)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
