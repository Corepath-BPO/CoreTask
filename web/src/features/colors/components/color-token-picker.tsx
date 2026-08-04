import { COLOR_TOKENS, type ColorToken } from '@coretask/contracts';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTheme } from '@/stores/theme.store';

import { resolveColorToken } from '../lib/color-tokens';

/**
 * Picks one of the nineteen semantic tokens.
 *
 * Radio semantics rather than a grid of buttons, because this is one choice
 * from a fixed set — that gives arrow-key navigation for free and announces
 * "3 of 19" instead of nineteen unrelated buttons.
 *
 * Every swatch carries its token name as its accessible label. Someone who
 * cannot tell violet from purple can still tell them apart, which is the whole
 * point of never letting colour be the only signal.
 */
export function ColorTokenPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: ColorToken;
  onChange: (token: ColorToken) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour"
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {COLOR_TOKENS.map((token) => {
        const swatch = resolveColorToken(token, resolvedTheme);
        const selected = token === value;

        return (
          <button
            key={token}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={token}
            disabled={disabled}
            onClick={() => onChange(token)}
            className={cn(
              'flex size-6 items-center justify-center rounded-md transition',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
              disabled && 'cursor-not-allowed opacity-50',
            )}
            style={{ backgroundColor: swatch.solid }}
          >
            {selected && (
              // White against every token in the set, which is why the palette
              // caps lightness rather than including near-white shades.
              <Check className="size-3.5 text-white" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
