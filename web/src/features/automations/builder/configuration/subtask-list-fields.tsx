import {
  MAX_SUBTASKS_PER_ACTION,
  isCalendarDate,
  subtaskEntry,
  type SubtaskEntry,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Folder,
  GripVertical,
  Pencil,
  Plus,
  Rows3,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CalendarGrid } from '@/components/ui/calendar-grid';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, formatDate, fromYmd, initials } from '@/lib/utils';

type Member = AutomationMetadata['members'][number];

/** How a subtask's due date is decided. */
const DUE_MODE = { NONE: 'NONE', DATE: 'DATE', RELATIVE: 'RELATIVE' } as const;
type DueMode = (typeof DUE_MODE)[keyof typeof DUE_MODE];

/**
 * Which mode a stored row is in, read from which key it holds.
 *
 * From the key rather than the value, so a row whose date is still empty stays
 * "a specific date" with its calendar showing — deriving it from the value
 * would flip the choice back to "no due date" the moment it was made.
 */
function dueModeOf(row: SubtaskEntry): DueMode {
  if (row.dueDate !== undefined) return DUE_MODE.DATE;
  if (row.dueInDays !== undefined) return DUE_MODE.RELATIVE;
  return DUE_MODE.NONE;
}

/** The rows as stored, blank ones included — see `SubtaskListFields`. */
function readRows(configuration: Record<string, unknown>): SubtaskEntry[] {
  const raw = configuration['subtasks'];
  const legacy = configuration['title'];

  if (Array.isArray(raw)) return raw.map(subtaskEntry);
  if (typeof legacy === 'string' && legacy !== '') return [{ title: legacy }];

  // One empty row, so the panel opens as a list to fill rather than a button
  // to press before anything can be typed.
  return [{ title: '' }];
}

/** A copy without the keys set to `undefined`: a dropped setting is gone, not present and empty. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** A set due date, in the few words that fit beside the row. */
function dueLabel(row: SubtaskEntry): string | null {
  if (isCalendarDate(row.dueDate)) return formatDate(row.dueDate);

  if (row.dueInDays !== undefined) {
    if (row.dueInDays === 0) return 'Same day';
    return `${row.dueInDays} day${row.dueInDays === 1 ? '' : 's'} after`;
  }

  return null;
}

/**
 * The subtasks a CREATE_SUBTASK step will create, as the checklist they are.
 *
 * Laid out the way a task list is: one line per subtask with its completion
 * circle, the title as words, and who and when on the right. What a row has
 * beyond its title appears on hover, as it does on a task row, so three
 * subtasks read as three lines rather than three forms.
 *
 * Blank rows live only here: somebody adding a subtask types into it after
 * making it, so the form keeps every row while `subtaskEntries` drops the
 * empty ones everywhere the list is *read* — the card, the validator, the
 * runner. Holding a half-typed list is the form's job alone.
 *
 * The two options underneath are shown as Asana shows them and say why they
 * cannot be changed: assignees follow their tasks throughout this application,
 * and no AI runs in it yet. The convention in this panel is disabled with a
 * reason rather than quietly missing.
 */
export function SubtaskListFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const rows = readRows(configuration);
  const members = metadata?.members ?? [];
  // Which row's title is being typed into. By position, as the rows are.
  const [editing, setEditing] = useState<number | null>(null);

  // `title` goes with the write: the runner prefers the list, but a stale
  // single title left beside it would resurface if the list were ever cleared.
  const write = (next: SubtaskEntry[]) =>
    onChange({ ...configuration, subtasks: next, title: undefined });

  // A dropped setting leaves the row rather than staying as `undefined`: which
  // keys a row holds is what says which mode it is in.
  const patch = (index: number, change: Partial<SubtaskEntry>) =>
    write(rows.map((row, at) => (at === index ? withoutUndefined({ ...row, ...change }) : row)));

  const remove = (index: number) => {
    setEditing(null);
    write(rows.filter((_, at) => at !== index));
  };

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click on the handle
    // is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Position is a row's only identity, so the sortable ids are positions too;
  // a reorder rewrites the whole list in its new order.
  const ids = rows.map((_, index) => `subtask-${index}`);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    setEditing(null);
    write(arrayMove(rows, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    // Bled to the panel's edges: the rows are a list, and a list with a margin
    // around it reads as a box inside a form.
    <div className="-mx-4 -mt-4">
      <p className="border-b border-amber-500/30 bg-amber-500/15 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
        Changes to subtasks will be saved with the rule.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul aria-label="Subtasks">
            {rows.map((row, index) => (
              <SubtaskRow
                // Position is the row's only identity, so the index is the honest key.
                key={index}
                id={ids[index] ?? ''}
                index={index}
                row={row}
                members={members}
                editing={editing === index || row.title === ''}
                onEdit={() => setEditing(index)}
                onDoneEditing={() => {
                  setEditing(null);
                  // A row left blank is a row nobody wanted — unless it is the
                  // only one, since an empty list needs somewhere to type.
                  if (row.title.trim() === '' && rows.length > 1) remove(index);
                }}
                onChange={(change) => patch(index, change)}
                onRemove={() => remove(index)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="px-4 pt-3">
        {rows.length < MAX_SUBTASKS_PER_ACTION && (
          <button
            type="button"
            onClick={() => {
              write([...rows, { title: '' }]);
              setEditing(rows.length);
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add subtask
          </button>
        )}

        <div className="mt-4 space-y-3">
          <OptionRow
            checked
            label="Add subtask assignees as collaborators"
            reason="Assignees follow their tasks throughout CoreTask, so this is always on."
          />
          <OptionRow
            checked={false}
            label="Let AI decide the number of subtasks to create"
            reason="No AI runs in this workspace yet."
          />
        </div>
      </div>
    </div>
  );
}

/** The controls a row shows only while it is pointed at, holds the keyboard, or has a menu open. */
const REVEAL =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';

const ICON_BUTTON =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40';

/**
 * One subtask, as a line.
 *
 * The title is words until somebody reaches for it — the pencil, or the words
 * themselves — and a box only while it is being typed into, so the list reads
 * as a list. The controls on the right are the row's own answers: who, when,
 * and what could be put in the title.
 */
function SubtaskRow({
  id,
  index,
  row,
  members,
  editing,
  onEdit,
  onDoneEditing,
  onChange,
  onRemove,
}: {
  id: string;
  index: number;
  row: SubtaskEntry;
  members: Member[];
  editing: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
  onChange: (change: Partial<SubtaskEntry>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const nth = `Subtask ${index + 1}`;
  const noun = nth.toLowerCase();
  const assignee = members.find((member) => member.id === row.assigneeId);
  const dated = dueModeOf(row) !== DUE_MODE.NONE;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex items-start gap-2 border-b border-border py-2.5 pl-6 pr-3',
        'hover:bg-accent/40 focus-within:bg-accent/40',
        isDragging && 'z-10 bg-accent/60 shadow-sm',
      )}
    >
      {/* Only while pointed at: a handle on every row is a column of dots
          beside a checklist. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${noun}`}
        className={cn(
          'absolute left-1 top-2.5 flex size-5 cursor-grab items-center justify-center rounded text-muted-foreground active:cursor-grabbing',
          REVEAL,
        )}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>

      <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <div className="min-w-0 flex-1 pt-px">
        {editing ? (
          <input
            value={row.title}
            onChange={(event) => onChange({ title: event.target.value })}
            onBlur={onDoneEditing}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            placeholder="Subtask title"
            aria-label={`${nth} title`}
            autoFocus
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="w-full cursor-text text-left text-sm text-foreground focus-visible:underline focus-visible:outline-none"
          >
            {row.title}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <VariableMenu noun={noun} />
        <DueDateControl nth={nth} row={row} onChange={onChange} className={dated ? '' : REVEAL} />
        <AssigneeControl nth={nth} assignee={assignee} members={members} onChange={onChange} />
        {editing ? (
          <button
            type="button"
            aria-label={`Remove ${noun}`}
            // Pressing it must not blur the input first: the blur would end
            // editing, and this would be a pencil by the time the click landed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRemove}
            className={ICON_BUTTON}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Edit ${noun}`}
            onClick={onEdit}
            className={cn(ICON_BUTTON, REVEAL)}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

/** A value nobody has chosen yet, drawn as the rule will fill it: a dashed ring with a bolt. */
function DashedGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="relative flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/60">
      <Icon className="size-3.5" aria-hidden="true" />
      <Zap className="absolute -bottom-0.5 -right-1 size-2.5 fill-current" aria-hidden="true" />
    </span>
  );
}

/**
 * What a title could be built from, if it could be built.
 *
 * Offered as Asana offers it and disabled for the reason the catalogue gives
 * every text-setting action: nothing here has variables, so a title is the
 * words somebody typed. The menu exists so that "can I put the task's name in
 * here?" has an answer other than a missing button.
 */
const VARIABLE_GROUPS: { label: string; icon: LucideIcon; opens?: boolean }[] = [
  { label: 'Use AI', icon: Sparkles },
  { label: 'Task', icon: CircleCheck, opens: true },
  { label: 'People', icon: UserRound, opens: true },
  { label: 'Dates', icon: CalendarDays, opens: true },
  { label: 'Custom fields', icon: SlidersHorizontal, opens: true },
  { label: 'Project', icon: Folder, opens: true },
  { label: 'Section', icon: Rows3, opens: true },
];

function VariableMenu({ noun }: { noun: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Add a variable to ${noun}`}
          className={cn(ICON_BUTTON, REVEAL)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-muted-foreground">Add variable</DropdownMenuLabel>
        {VARIABLE_GROUPS.map(({ label, icon: Icon, opens }) => (
          <DropdownMenuItem key={label} disabled>
            <Icon aria-hidden="true" />
            {label}
            {opens && <ChevronRight className="ml-auto" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <p className="px-2 py-1.5 text-xs italic text-muted-foreground">
          Variables are not available yet, so a title is the words you type.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * When the subtask is due: nothing, a day somebody picks, or a number of days
 * after the rule runs — which is what a checklist usually means by "due", since
 * a fixed date written into a rule is stale the week after.
 */
function DueDateControl({
  nth,
  row,
  onChange,
  className,
}: {
  nth: string;
  row: SubtaskEntry;
  onChange: (change: Partial<SubtaskEntry>) => void;
  className: string;
}) {
  const mode = dueModeOf(row);
  const label = dueLabel(row);
  const [month, setMonth] = useState(() =>
    isCalendarDate(row.dueDate) ? fromYmd(row.dueDate) : new Date(),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${nth} due date`}
          className={cn(ICON_BUTTON, label && 'w-auto gap-1 px-1.5 text-foreground', className)}
        >
          {label ? (
            <>
              <CalendarDays className="size-3.5" aria-hidden="true" />
              <span className="text-xs">{label}</span>
            </>
          ) : (
            <DashedGlyph icon={CalendarDays} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div role="radiogroup" aria-label={`${nth} due date`}>
          <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">Due date</p>
          <ModeRow
            active={mode === DUE_MODE.NONE}
            onSelect={() => onChange({ dueDate: undefined, dueInDays: undefined })}
          >
            No due date
          </ModeRow>
          <ModeRow
            active={mode === DUE_MODE.RELATIVE}
            // One day rather than zero: "the day it runs" is a choice worth
            // making on purpose, and a zero looks like a box nobody filled in.
            onSelect={() => {
              if (mode !== DUE_MODE.RELATIVE) onChange({ dueDate: undefined, dueInDays: 1 });
            }}
          >
            Days after the rule runs
          </ModeRow>
          {mode === DUE_MODE.RELATIVE && (
            <div className="flex items-center gap-2 py-1.5 pl-8 pr-2">
              <input
                type="number"
                min={0}
                step={1}
                value={row.dueInDays ?? 0}
                onChange={(event) => {
                  // Whole days, none fewer than zero. Clearing the box is zero
                  // rather than a vanished mode; see `dueModeOf`.
                  const parsed = Number(event.target.value);
                  onChange({
                    dueInDays: Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0,
                  });
                }}
                aria-label={`${nth} days after the rule runs`}
                className="h-8 w-16 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
              />
              <span className="text-xs text-muted-foreground">days after the rule runs</span>
            </div>
          )}
          <ModeRow
            active={mode === DUE_MODE.DATE}
            onSelect={() => {
              if (mode !== DUE_MODE.DATE) onChange({ dueDate: '', dueInDays: undefined });
            }}
          >
            A specific date
          </ModeRow>
        </div>

        {mode === DUE_MODE.DATE && (
          <div className="mt-1 border-t border-border pt-2">
            <CalendarGrid
              month={month}
              onMonthChange={setMonth}
              rangeEnd={isCalendarDate(row.dueDate) ? row.dueDate : null}
              onSelect={(day) => onChange({ dueDate: day, dueInDays: undefined })}
              ariaLabel={`${nth} due on`}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One way of deciding the date, marked with a radio as the single-choice lists in these panels are. */
function ModeRow({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-primary' : 'border-muted-foreground/50',
        )}
      >
        {active && <span className="size-2 rounded-full bg-primary" />}
      </span>
      {children}
    </button>
  );
}

/** Who the subtask goes to: a face when somebody, the rule's dashed ring when nobody yet. */
function AssigneeControl({
  nth,
  assignee,
  members,
  onChange,
}: {
  nth: string;
  assignee: Member | undefined;
  members: Member[];
  onChange: (change: Partial<SubtaskEntry>) => void;
}) {
  const [open, setOpen] = useState(false);

  const choose = (assigneeId: string | undefined) => {
    onChange({ assigneeId });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${nth} assignee`} className={ICON_BUTTON}>
          {assignee ? <Face member={assignee} /> : <DashedGlyph icon={UserRound} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            <CommandEmpty>Nobody matches.</CommandEmpty>
            <CommandItem value="Unassigned" onSelect={() => choose(undefined)}>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60">
                <UserRound className="size-3.5" aria-hidden="true" />
              </span>
              Unassigned
            </CommandItem>
            {members.map((member) => (
              // The id rides along in the value so two people with one name
              // stay two rows; the search still matches on the name.
              <CommandItem
                key={member.id}
                value={`${member.name} ${member.id}`}
                onSelect={() => choose(member.id)}
              >
                <Face member={member} />
                <span className="truncate">{member.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A member as a face, the way the rest of the application shows one. */
function Face({ member }: { member: Member }) {
  return (
    <Avatar className="size-6">
      {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
      <AvatarFallback className="text-[10px]">{initials(member.name)}</AvatarFallback>
    </Avatar>
  );
}

/** One of the step's options, shown as it is and saying why it cannot be changed. */
function OptionRow({
  label,
  reason,
  checked,
}: {
  label: string;
  reason: string;
  checked: boolean;
}) {
  return (
    <label className="flex cursor-not-allowed items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled
        readOnly
        className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground">{label}</span>
        <span className="text-xs italic text-muted-foreground">{reason}</span>
      </span>
    </label>
  );
}
