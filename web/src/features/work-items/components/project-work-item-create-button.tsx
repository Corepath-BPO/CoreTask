import {
  WORK_ITEM_TYPE_ACTION_LABEL,
  WORK_ITEM_TYPE_DESCRIPTION,
  WORK_ITEM_TYPE_LABEL,
  type CreatableWorkItemType,
  type WorkItemType,
} from '@coretask/contracts';
import { ChevronDown, Loader2, Plus, Rows3 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useWorkItemPermissions } from '../hooks/use-work-item-permissions';

import { WorkItemTypeIcon } from './work-item-type-icon';

export interface WorkItemCreateContext {
  projectId: string;
  sectionId?: string | undefined;
  parentId?: string | undefined;
  sourceView: 'LIST' | 'BOARD' | 'OVERVIEW';
}

interface Props {
  /** The project's configured default. Decides the main segment's label. */
  defaultType: CreatableWorkItemType;
  context: WorkItemCreateContext;
  /** Opens the create experience for a type. The caller decides quick vs full. */
  onCreate: (type: WorkItemType, context: WorkItemCreateContext) => void;
  onCreateSection?: (() => void) | undefined;
  pending?: boolean;
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * The one "+ Add" control, shared by every project view.
 *
 * A split button rather than a plain one: the common case is adding another of
 * whatever this project mostly holds, and making that a two-step menu choice
 * every time is the tax the Board's task-only composer avoided by simply not
 * offering the alternative.
 *
 *   ┌──────────────────┬────┐
 *   │  + Add ticket    │ ▼  │
 *   └──────────────────┴────┘
 *
 * The left segment acts immediately on the project default. The right opens the
 * menu, which lists every declared type — the ones that cannot be built yet are
 * disabled and say so, because hiding them makes "coming" indistinguishable
 * from "never considered", and offering them would write a task wearing a
 * milestone's label.
 *
 * Rendering nothing when the caller may not create is deliberate: a disabled
 * button invites somebody to keep clicking and wonder what is broken.
 */
export function ProjectWorkItemCreateButton({
  defaultType,
  context,
  onCreate,
  onCreateSection,
  pending = false,
  size = 'sm',
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const permissions = useWorkItemPermissions();

  if (!permissions.canCreate) return null;

  const height = size === 'sm' ? 'h-8' : 'h-9';

  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <Button
        type="button"
        size={size}
        disabled={pending}
        onClick={() => onCreate(defaultType, context)}
        // The two segments read as one control: the seam is a single border and
        // only the outer corners are rounded.
        className={cn(
          height,
          'cursor-pointer rounded-r-none border-r border-primary-foreground/20',
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        {WORK_ITEM_TYPE_ACTION_LABEL[defaultType]}
      </Button>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size={size}
            disabled={pending}
            // Named for what it does, not what it looks like. "Chevron" tells a
            // screen-reader user nothing about where it leads.
            aria-label="Choose what to add"
            className={cn(height, 'cursor-pointer rounded-l-none px-2')}
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Create work item</DropdownMenuLabel>

          {permissions.creatableTypes.map((type) => (
            <DropdownMenuItem
              key={type}
              className="cursor-pointer gap-2"
              onSelect={() => onCreate(type, context)}
            >
              <WorkItemTypeIcon type={type} />
              <span className="flex-1">{WORK_ITEM_TYPE_LABEL[type]}</span>
              {type === defaultType && (
                <span className="text-xs text-muted-foreground">Default</span>
              )}
            </DropdownMenuItem>
          ))}

          {permissions.comingSoonTypes.map((type) => (
            <DropdownMenuItem
              key={type}
              disabled
              // `onSelect` still prevented: a disabled Radix item does not fire,
              // but leaving the handler off makes that a property of the library
              // rather than of this component.
              onSelect={(event) => event.preventDefault()}
              title={WORK_ITEM_TYPE_DESCRIPTION[type]}
              className="gap-2"
            >
              <WorkItemTypeIcon type={type} />
              <span className="flex-1">{WORK_ITEM_TYPE_LABEL[type]}</span>
              <span className="text-xs text-muted-foreground">Coming soon</span>
            </DropdownMenuItem>
          ))}

          {onCreateSection && permissions.canCreateSection && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer gap-2" onSelect={onCreateSection}>
                <Rows3 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">Section</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
