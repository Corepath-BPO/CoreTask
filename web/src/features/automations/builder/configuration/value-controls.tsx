import { ChevronDown } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** One thing that can be chosen, with a face when the thing is a person. */
export interface ChoiceOption {
  value: string;
  label: string;
  /** Set only for people, so a member picker looks like one. */
  avatarUrl?: string | null;
}

/**
 * Choosing several of something.
 *
 * A menu of checkboxes rather than a listbox with roving focus: Radix already
 * gives this arrow keys, type-ahead, Escape and focus that returns to the
 * trigger, and `menuitemcheckbox` says "several of these may be on" in a way a
 * row of buttons pretending to be options does not.
 *
 * The menu deliberately stays open as each one is ticked. "Section is one of…"
 * is a question with more than one answer by definition, and a menu that shut
 * after the first would make choosing three sections three round trips.
 */
export function MultiSelect({
  id,
  options,
  values,
  onChange,
  placeholder,
}: {
  id: string;
  options: ChoiceOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const chosen = values
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is ChoiceOption => Boolean(option));

  const toggle = (value: string) =>
    onChange(
      values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value],
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        // Shaped like the select beside it: two controls doing the same job on
        // one form should not look like two kinds of control.
        className={cn(
          'flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-left text-sm shadow-xs',
          'transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {chosen.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          /* Chips, not a comma-joined line: the values are the answer and the
             words around them are not, which is what makes a filled-in form
             scannable rather than something to read. */
          <span className="flex flex-1 flex-wrap gap-1">
            {chosen.map((option) => (
              <Badge key={option.value} variant="muted" className="max-w-full truncate">
                {option.label}
              </Badge>
            ))}
          </span>
        )}

        <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        // As wide as the control it belongs to, so the labels do not wrap in the
        // menu and then read differently in the trigger.
        className="max-h-72 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
      >
        {options.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">Nothing to choose.</p>
        )}

        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={values.includes(option.value)}
            // Radix closes a menu on select; ticking a second box has to be
            // possible without reopening it.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(option.value)}
          >
            <OptionFace option={option} />
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A choice as it reads in a list.
 *
 * The avatar is only ever beside a name. A face against a section would be
 * decoration; against a person it is the fastest way to find the right one in a
 * workspace with two Sarahs.
 */
export function OptionFace({ option }: { option: ChoiceOption }) {
  if (option.avatarUrl === undefined) return <span className="truncate">{option.label}</span>;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-5">
        {option.avatarUrl && <AvatarImage src={option.avatarUrl} alt="" />}
        <AvatarFallback>{option.label.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate">{option.label}</span>
    </span>
  );
}
