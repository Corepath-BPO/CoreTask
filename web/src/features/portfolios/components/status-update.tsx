import { Check, ChevronDown, Circle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  useProjectStatusUpdate,
  type ProjectStatusUpdateValue,
} from '@/stores/status-update.store';

import { STATUS_UPDATE_OPTIONS, statusUpdateOption } from '../lib/status-updates';

export function StatusUpdateChip({ status }: { status: ProjectStatusUpdateValue }) {
  const option = statusUpdateOption(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
        option.chip,
      )}
    >
      {option.filled ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className={cn('size-2 rounded-full', option.dot)} />
      )}
      {option.label}
    </span>
  );
}

/** The latest local update for a project, or Asana's "No recent updates". */
export function ProjectStatusUpdateChip({ projectId }: { projectId: string }) {
  const update = useProjectStatusUpdate(projectId);

  if (!update) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Circle className="size-2.5" aria-hidden="true" />
        No recent updates
      </span>
    );
  }

  return <StatusUpdateChip status={update.status} />;
}

/**
 * The "Update status" dropdown, chip-per-option like Asana's. Picking a
 * status does not set it directly — it opens the composer, the same way
 * Asana walks the change through a post that notifies people.
 */
export function StatusUpdateMenu({
  onPick,
  tabIndex,
  trigger,
}: {
  onPick: (status: ProjectStatusUpdateValue) => void;
  tabIndex?: number;
  /** Replaces the default "Update status" button — the menu stays the same. */
  trigger?: React.ReactElement;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" {...(tabIndex !== undefined ? { tabIndex } : {})}>
            Update status
            <ChevronDown aria-hidden="true" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {STATUS_UPDATE_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onPick(option.value)}>
            <StatusUpdateChip status={option.value} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Asking someone for an update needs notifications, which this
            browser-local build does not have. */}
        <DropdownMenuItem disabled>Request status update</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
