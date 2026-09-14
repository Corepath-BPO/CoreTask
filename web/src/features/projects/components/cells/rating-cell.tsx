import { Star } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A row of stars, one click to set and one on the current star to clear.
 *
 * A radio group rather than a number input, because a rating is chosen at a
 * glance: three of five stars means something a "3" in a box does not. The
 * keyboard reaches every star with the arrow keys, as a radio group should;
 * read-only rows render the same stars without the buttons behind them.
 */
export function RatingCell({
  value,
  max,
  canEdit,
  label,
  onCommit,
}: {
  value: number | null;
  max: number;
  canEdit: boolean;
  label: string;
  onCommit: (value: number | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value ?? 0;
  const stars = Array.from({ length: max }, (_, index) => index + 1);

  if (!canEdit) {
    return (
      <span
        role="img"
        aria-label={value === null ? `${label}: not rated` : `${label}: ${value} of ${max}`}
        className="inline-flex items-center gap-0.5"
      >
        {stars.map((star) => (
          <StarGlyph key={star} filled={star <= (value ?? 0)} />
        ))}
      </span>
    );
  }

  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5"
      onMouseLeave={() => setHovered(null)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          onCommit(Math.min(max, (value ?? 0) + 1));
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          const next = (value ?? 0) - 1;
          onCommit(next <= 0 ? null : next);
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          onCommit(null);
        }
      }}
    >
      {stars.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} of ${max}`}
          // One tab stop for the group; the arrows move within it.
          tabIndex={star === (value ?? 1) ? 0 : -1}
          onMouseEnter={() => setHovered(star)}
          onFocus={() => setHovered(null)}
          onClick={(event) => {
            event.stopPropagation();
            // Clicking the star already chosen takes the rating away, which
            // is the only way a row of stars can express "no rating".
            onCommit(value === star ? null : star);
          }}
          className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <StarGlyph filled={star <= shown} dim={hovered !== null && star > (value ?? 0)} />
        </button>
      ))}
    </span>
  );
}

function StarGlyph({ filled, dim = false }: { filled: boolean; dim?: boolean }) {
  return (
    <Star
      className={cn(
        'size-3.5 transition-colors',
        filled ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
        dim && filled && 'fill-amber-300 text-amber-300',
      )}
      aria-hidden="true"
    />
  );
}
