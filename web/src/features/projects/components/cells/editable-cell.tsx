import { cn } from '@/lib/utils';

/**
 * A cell that looks like text until it is clicked.
 *
 * Deliberately a button rather than a div with a click handler: a grid whose
 * cells cannot be reached by keyboard is a grid only mouse users can edit, and
 * the whole point of this view is editing without opening the task.
 */
export function CellButton({
  onOpen,
  ariaLabel,
  children,
  className,
  disabled,
}: {
  onOpen: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return <span className={cn('block truncate px-1 py-0.5 text-sm', className)}>{children}</span>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className={cn(
        'block w-full truncate rounded px-1 py-0.5 text-left text-sm',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Placeholder for an unset value, so an empty cell is still a target. */
export function EmptyCell() {
  return <span className="text-muted-foreground">—</span>;
}
