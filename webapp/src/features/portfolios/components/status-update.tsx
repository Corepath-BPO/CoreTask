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
} from '@/features/projects/hooks/use-project-updates';

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

/** A project's newest posted update, or Asana's "No recent updates". */
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
  onRequest,
  canPick = true,
  tabIndex,
  trigger,
}: {
  onPick: (status: ProjectStatusUpdateValue) => void;
  /** "Request status update": ask the owner. Left out, the item is not offered. */
  onRequest?: () => void;
  /** False for someone who may ask for an update but not post one. */
  canPick?: boolean;
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
        {canPick &&
          STATUS_UPDATE_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.value} onSelect={() => onPick(option.value)}>
              <StatusUpdateChip status={option.value} />
            </DropdownMenuItem>
          ))}
        {canPick && onRequest && <DropdownMenuSeparator />}
        {onRequest && (
          <DropdownMenuItem onSelect={onRequest}>Request status update</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
