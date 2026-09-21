import { resolveColor } from '@/features/colors/lib/color-tokens';
import { cn } from '@/lib/utils';
import { useTheme } from '@/stores/theme.store';

/**
 * A value as the tinted chip the rest of the app knows it by.
 *
 * Everywhere else a status or a select option is a coloured token — the board,
 * the list, the field editor — so a rule that names one in plain text reads as
 * naming something else. One component rather than a style repeated, because
 * the chip appears in three places (a card, a select item, a chosen badge) and
 * three hand-copied tints is how one of them ends up a different colour.
 *
 * Not `SemanticBadge`: that pairs the tint with a dot, which earns its place in
 * a long list and is noise inside a sentence like "Outcome is set to ⟨chip⟩".
 */
export function OptionChip({
  label,
  colorToken,
  className,
}: {
  label: string;
  colorToken: string;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const swatch = resolveColor({ colorToken }, resolvedTheme);

  return (
    <span
      className={cn(
        'inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium',
        className,
      )}
      style={{ backgroundColor: swatch.surface, color: swatch.onSurface }}
    >
      {label}
    </span>
  );
}
