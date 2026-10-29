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
  Rows3,
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

/** What one column's menu may do; an action left out is not offered. */
export interface ColumnMenuActions {
  onEditField?: (() => void) | undefined;
  onSort?: ((direction: SortDirection) => void) | undefined;
  onFilter?: (() => void) | undefined;
  onGroup?: (() => void) | undefined;
  /** Fields that could be added as columns, each with its label. */
  addable?: { field: string; label: string }[] | undefined;
  onAdd?: ((field: string) => void) | undefined;
  onMove?: ((direction: -1 | 1) => void) | undefined;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  isPinned?: boolean;
  onPin?: ((isPinned: boolean) => void) | undefined;
  onHide?: (() => void) | undefined;
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
  } = actions;

  const view = Boolean(onSort || onFilter || onGroup);
  const layout = Boolean((onAdd && addable.length > 0) || onMove || onPin || onHide);
  if (!onEditField && !view && !layout) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Show options for ${label} column`}
        className="shrink-0 cursor-pointer rounded p-0.5 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover/header:opacity-100 data-[state=open]:opacity-100"
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onEditField && (
          <DropdownMenuItem onSelect={onEditField}>
            <Pencil />
            Edit field
          </DropdownMenuItem>
        )}
        {onEditField && view && <DropdownMenuSeparator />}

        {onSort && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
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
          <DropdownMenuItem onSelect={onGroup}>
            <Rows3 />
            Group
          </DropdownMenuItem>
        )}

        {view && layout && <DropdownMenuSeparator />}

        {onAdd && addable.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
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
            <DropdownMenuSubTrigger>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
