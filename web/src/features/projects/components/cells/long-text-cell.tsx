import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

import { CellButton, EmptyCell } from './editable-cell';

/**
 * A text field configured for paragraphs rather than a line.
 *
 * A popover rather than an inline input, because a row is one line tall and a
 * paragraph typed into it is a paragraph nobody can read back. The cell still
 * shows the first line, so the grid stays scannable and the column keeps its
 * width.
 *
 * Enter inserts a newline here — the whole point of a long field — so saving
 * needs its own control. Escape still discards, which is the one habit worth
 * keeping identical across every cell in the grid.
 */
export function LongTextCell({
  value,
  canEdit,
  label,
  placeholder,
  maxLength,
  onCommit,
}: {
  value: string;
  canEdit: boolean;
  label: string;
  placeholder?: string;
  maxLength?: number;
  onCommit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  // Radix returns focus to the trigger when a popover closes, so there is
  // nothing to restore by hand.
  const close = () => setOpen(false);

  const save = () => {
    // Only when it changed, so opening and closing a cell writes nothing.
    if (draft !== value) onCommit(draft);
    close();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          // Seeded on open rather than by an effect: the draft belongs to this
          // visit, and syncing it from props would fight anyone mid-sentence.
          setDraft(value);
          setOpen(true);
          return;
        }

        // Closing by clicking away keeps what was typed, matching every other
        // cell in the grid, where blur saves.
        save();
      }}
    >
      <PopoverTrigger asChild disabled={!canEdit}>
        <span>
          <CellButton
            onOpen={() => setOpen(true)}
            disabled={!canEdit}
            ariaLabel={label}
            className="text-xs"
          >
            {/* One line in the grid: the rest is a click away, and a wrapped
                paragraph would make every row in the table taller. */}
            {value ? value.split('\n')[0] : <EmptyCell />}
          </CellButton>
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 space-y-2">
        <Textarea
          autoFocus
          rows={5}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDraft(value);
              close();
            }
          }}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {maxLength ? `${draft.length}/${maxLength}` : 'Escape discards'}
          </span>
          <Button type="button" size="sm" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
