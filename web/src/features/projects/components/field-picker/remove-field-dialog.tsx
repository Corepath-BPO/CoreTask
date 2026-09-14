import type { CustomField, RemoveFieldMode } from '@coretask/types';
import { Library, Trash2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';

/**
 * Asana's choice when a field leaves a project: remove it from here, or
 * delete it from the workspace.
 *
 * Two outcomes that used to be one implicit decision. The old dialog said
 * "delete" and the API chose between detaching, archiving and deleting from
 * state nobody could see — so the same click did three different things on
 * three different days. Now the person says which they mean, and the copy
 * says what will happen to the other projects and to the data.
 */
export function RemoveFieldDialog({
  field,
  usageCount,
  pending,
  onOpenChange,
  onConfirm,
}: {
  field: CustomField;
  /** How many projects use the field, including this one; null while unknown. */
  usageCount: number | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: RemoveFieldMode) => void;
}) {
  const [mode, setMode] = useState<RemoveFieldMode>('detach');
  const others = usageCount === null ? null : Math.max(0, usageCount - 1);

  const otherProjects =
    others === null
      ? 'any other project that uses it'
      : others === 0
        ? 'no other project'
        : others === 1
          ? '1 other project'
          : `${others} other projects`;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove “{field.name}”?</DialogTitle>
          <DialogDescription>
            It is used by {otherProjects}. Choose what should happen to it.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="What to do with the field" className="space-y-2">
          <Choice
            checked={mode === 'detach'}
            onSelect={() => setMode('detach')}
            icon={<Library className="size-4" aria-hidden="true" />}
            title="Remove from this project"
            description="The field stays in the workspace library, with its options and the values other projects hold. You can add it back later."
          />
          <Choice
            checked={mode === 'delete'}
            onSelect={() => setMode('delete')}
            icon={<Trash2 className="size-4" aria-hidden="true" />}
            title="Delete from the workspace"
            description={
              others === 0
                ? 'Removed from the library. If tasks hold values for it, it is archived instead so nothing typed is lost.'
                : `Removed from every project, ${otherProjects} included. If tasks hold values for it, it is archived instead so nothing typed is lost.`
            }
            destructive
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={mode === 'delete' ? 'destructive' : 'default'}
            loading={pending}
            onClick={() => onConfirm(mode)}
          >
            {mode === 'delete' ? 'Delete field' : 'Remove from project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  checked,
  onSelect,
  icon,
  title,
  description,
  destructive = false,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        checked && 'border-primary bg-primary/5',
        checked && destructive && 'border-destructive bg-destructive/5',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0 text-muted-foreground',
          checked && (destructive ? 'text-destructive' : 'text-primary'),
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
