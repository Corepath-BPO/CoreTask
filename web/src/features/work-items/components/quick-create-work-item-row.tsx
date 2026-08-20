import {
  CREATABLE_WORK_ITEM_TYPES,
  WORK_ITEM_TYPE_ACTION_LABEL,
  WORK_ITEM_TYPE_LABEL,
  type CreatableWorkItemType,
  type WorkItemType,
} from '@coretask/contracts';
import { Loader2, Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useWorkItemPermissions } from '../hooks/use-work-item-permissions';

import { WorkItemTypeIcon } from './work-item-type-icon';

interface Props {
  /** The type this row creates unless somebody changes it. */
  defaultType: CreatableWorkItemType;
  /** Named for the section it sits in, so the label says where it lands. */
  sectionName?: string | undefined;
  onCreate: (input: { type: WorkItemType; title: string }) => Promise<unknown>;
  pending?: boolean;
  className?: string;
  /** Asana's list styling: "Add task…" alone, no leading plus. */
  plain?: boolean;
}

/**
 * The "Add ticket…" row at the foot of a section.
 *
 * Adding work is the most repeated thing anybody does here, and a dialog per
 * item makes a list of ten a list of thirty clicks. So this is a closed row that
 * opens into an input, submits on Enter, and **stays open** — the next title can
 * be typed straight away.
 *
 * The type is settable per row rather than fixed to the project default: a
 * mostly-task project still files the occasional ticket, and making that a trip
 * to the toolbar is how people stop bothering.
 */
export function QuickCreateWorkItemRow({
  defaultType,
  sectionName,
  onCreate,
  pending = false,
  className,
  plain = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<WorkItemType>(defaultType);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const permissions = useWorkItemPermissions();
  if (!permissions.canCreate) return null;

  const submit = async () => {
    const next = title.trim();

    if (next === '') {
      setOpen(false);
      return;
    }

    // Cleared before the request, not after: the field has to be ready for the
    // next title immediately, and waiting for the server makes fast typing
    // overwrite what was just submitted.
    setTitle('');
    await onCreate({ type, title: next });
    inputRef.current?.focus();
  };

  if (!open) {
    return (
      <button
        type="button"
        /*
         * Named in full rather than by a visually-hidden suffix.
         *
         * "Add ticket" repeated down a page tells somebody listening nothing
         * about which section they are on. An `sr-only` span looked like the
         * tidier way to add it, but the accessible name is built by joining the
         * trimmed text of each node — the leading space disappears and it reads
         * "Add ticketto Incoming Request".
         */
        aria-label={
          sectionName ? `${WORK_ITEM_TYPE_ACTION_LABEL[defaultType]} to ${sectionName}` : undefined
        }
        onClick={() => {
          setOpen(true);
          // The input mounts this tick; focusing it has to wait for the next.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-muted-foreground',
          'hover:bg-muted/40 hover:text-foreground focus-visible:outline-none',
          'focus-visible:ring-[3px] focus-visible:ring-ring/40',
          className,
        )}
      >
        {!plain && <Plus className="size-4" aria-hidden="true" />}
        {plain
          ? `${WORK_ITEM_TYPE_ACTION_LABEL[defaultType]}…`
          : WORK_ITEM_TYPE_ACTION_LABEL[defaultType]}
      </button>
    );
  }

  return (
    <div ref={rowRef} className={cn('flex items-center gap-1.5 px-3 py-1.5', className)}>
      <DropdownMenu open={typeMenuOpen} onOpenChange={setTypeMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Type: ${WORK_ITEM_TYPE_LABEL[type]}. Change it.`}
            className="cursor-pointer rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <WorkItemTypeIcon type={type} />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-44">
          {CREATABLE_WORK_ITEM_TYPES.map((option) => (
            <DropdownMenuItem
              key={option}
              className="cursor-pointer gap-2"
              onSelect={() => {
                setType(option);
                inputRef.current?.focus();
              }}
            >
              <WorkItemTypeIcon type={option} />
              {WORK_ITEM_TYPE_LABEL[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          }

          if (event.key === 'Escape') {
            setTitle('');
            setOpen(false);
          }
        }}
        /*
         * Three ways this row is allowed to survive losing focus.
         *
         * Reaching for the type icon closed it under you: the input blurred,
         * the title was still empty, and the whole row unmounted before the
         * menu could open. The menu's own state is the reliable signal — it is
         * still open regardless of where focus went, and the menu content is
         * portalled outside this element so containment alone cannot see it.
         * `relatedTarget` covers the instant before the menu registers as open,
         * and a non-empty title covers a stray click that would otherwise lose
         * what somebody was in the middle of typing.
         */
        onBlur={(event) => {
          if (typeMenuOpen) return;

          const next = event.relatedTarget as Node | null;
          if (next && rowRef.current?.contains(next)) return;

          if (title.trim() === '') setOpen(false);
        }}
        placeholder={
          sectionName
            ? `${WORK_ITEM_TYPE_LABEL[type]} in ${sectionName}…`
            : `${WORK_ITEM_TYPE_LABEL[type]} title…`
        }
        aria-label={
          sectionName
            ? `New ${WORK_ITEM_TYPE_LABEL[type].toLowerCase()} in ${sectionName}`
            : `New ${WORK_ITEM_TYPE_LABEL[type].toLowerCase()}`
        }
        className="h-8 flex-1"
      />

      {pending && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
