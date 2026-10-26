import type { Ref } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { cn } from '@/lib/utils';

import type { MentionCandidate } from './extensions/mention';

interface MentionListProps {
  items: MentionCandidate[];
  highlighted: number;
  onPick: (candidate: MentionCandidate) => void;
  onHighlight: (index: number) => void;
  /** The list node, for the editor to place under the caret. */
  ref?: Ref<HTMLUListElement>;
}

/**
 * The `@` picker under the caret — the comment composer's list, drawn inside
 * the editor's own box so the dialog around it never sees a click "outside".
 */
export function MentionList({ items, highlighted, onPick, onHighlight, ref }: MentionListProps) {
  return (
    <ul
      ref={ref}
      role="listbox"
      aria-label="Mention a teammate"
      className="absolute z-20 max-h-56 w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
    >
      {items.map((candidate, index) => (
        <li key={candidate.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === highlighted}
            // `onMouseDown` rather than `onClick`: the editor would blur first,
            // save, and close the list before a click could land.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(candidate);
            }}
            onMouseEnter={() => onHighlight(index)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
              index === highlighted && 'bg-accent text-accent-foreground',
            )}
          >
            <PersonAvatar
              name={candidate.name}
              avatarUrl={candidate.avatarUrl}
              className="size-5 shrink-0"
              fallbackClassName="text-[9px]"
            />
            <span className="truncate">{candidate.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
