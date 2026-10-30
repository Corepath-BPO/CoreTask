import { SortDirection } from '@coretask/contracts';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUpNarrowWide,
  ChevronDown,
  Columns3,
  EyeOff,
  ListFilter,
  MoveHorizontal,
  Pencil,
  Pin,
  PinOff,
  Replace,
  Rows3,
  Trash2,
  Zap,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** A submenu row's icon sized and tinted as a plain row's is. */
const SUB_TRIGGER =
  "gap-2 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

/** What one column's menu may do; an action left out is not offered. */
export interface ColumnMenuActions {
  onEditField?: (() => void) | undefined;
  /** The Assignee column's "Find and replace": one person's rows to another. */
  onReplaceAssignee?: (() => void) | undefined;
  onSort?: ((direction: SortDirection) => void) | undefined;
  onFilter?: (() => void) | undefined;
  onGroup?: ((direction: SortDirection) => void) | undefined;
  /** Fields that could be added as columns, each with its label. */
  addable?: { field: string; label: string }[] | undefined;
  onAdd?: ((field: string) => void) | undefined;
  onMove?: ((direction: -1 | 1) => void) | undefined;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  isPinned?: boolean;
  onPin?: ((isPinned: boolean) => void) | undefined;
  onHide?: (() => void) | undefined;
  /** A rule that starts when this field changes. */
  onAddAutomation?: (() => void) | undefined;
  /** Off this project, or out of the workspace: the field's own remove dialog. */
  onDelete?: (() => void) | undefined;
}

/**
 * A column header's menu, as Asana's: the chevron that appears on hover, with
 * the field's own settings first, then how the view reads it — sort, filter,
 * group — then where the column sits. What a column cannot do is left out
 * rather than greyed: the Task column, like Asana's, only sorts.
 */
export function ColumnMenu({ label, actions }: { label: string; actions: ColumnMenuActions }) {
  const {
    onEditField,
    onReplaceAssignee,
    onSort,
    onFilter,
    onGroup,
    addable = [],
    onAdd,
    onMove,
    canMoveLeft = false,
    canMoveRight = false,
    isPinned = false,
    onPin,
    onHide,
    onAddAutomation,
    onDelete,
  } = actions;

  const own = Boolean(onEditField || onReplaceAssignee);
  const view = Boolean(onSort || onFilter || onGroup);
  const layout = Boolean((onAdd && addable.length > 0) || onMove || onPin || onHide);
  if (!own && !view && !layout && !onAddAutomation && !onDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Show options for ${label} column`}
        className="shrink-0 cursor-pointer rounded p-0.5 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover/header:opacity-100 data-[state=open]:opacity-100"
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {onEditField && (
          <DropdownMenuItem onSelect={onEditField}>
            <Pencil />
            Edit field
          </DropdownMenuItem>
        )}
        {onReplaceAssignee && (
          <DropdownMenuItem onSelect={onReplaceAssignee}>
            <Replace />
            Find and replace assignee
          </DropdownMenuItem>
        )}
        {own && view && <DropdownMenuSeparator />}

        {onSort && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={SUB_TRIGGER}>
              <ArrowUpDown />
              Sort
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => onSort(SortDirection.ASC)}>
                <ArrowUpNarrowWide />
                Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSort(SortDirection.DESC)}>
                <ArrowDownWideNarrow />
                Sort descending
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {onFilter && (
          <DropdownMenuItem onSelect={onFilter}>
            <ListFilter />
            Filter
          </DropdownMenuItem>
        )}
        {onGroup && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={SUB_TRIGGER}>
              <Rows3 />
              Group
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => onGroup(SortDirection.ASC)}>
                <ArrowUpNarrowWide />
                Group ascending
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onGroup(SortDirection.DESC)}>
                <ArrowDownWideNarrow />
                Group descending
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {view && layout && <DropdownMenuSeparator />}

        {onAdd && addable.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={SUB_TRIGGER}>
              <Columns3 />
              Add column
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
              {addable.map((option) => (
                <DropdownMenuItem key={option.field} onSelect={() => onAdd(option.field)}>
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {onMove && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={SUB_TRIGGER}>
              <MoveHorizontal />
              Move column
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={!canMoveLeft} onSelect={() => onMove(-1)}>
                <ArrowLeft />
                Move left
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveRight} onSelect={() => onMove(1)}>
                <ArrowRight />
                Move right
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {onPin && (
          <DropdownMenuItem onSelect={() => onPin(!isPinned)}>
            {isPinned ? <PinOff /> : <Pin />}
            {isPinned ? 'Unpin column' : 'Pin column'}
          </DropdownMenuItem>
        )}
        {onHide && (
          <DropdownMenuItem onSelect={onHide}>
            <EyeOff />
            Hide column
          </DropdownMenuItem>
        )}

        {onAddAutomation && (view || layout || own) && <DropdownMenuSeparator />}
        {onAddAutomation && (
          <DropdownMenuItem onSelect={onAddAutomation}>
            <Zap />
            Add automation to field
          </DropdownMenuItem>
        )}

        {onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Delete field
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
