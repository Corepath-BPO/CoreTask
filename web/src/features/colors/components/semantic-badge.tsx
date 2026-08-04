import type { ColorToken } from '@coretask/contracts';

import { cn } from '@/lib/utils';
import { useTheme } from '@/stores/theme.store';

import { resolveColor } from '../lib/color-tokens';

interface ColorSource {
  colorToken?: ColorToken | string | null;
  customColor?: string | null;
}

/**
 * A small filled circle in a stored colour.
 *
 * Always `aria-hidden`: a dot on its own says nothing to a screen reader, so
 * every caller pairs it with the label it belongs to. That pairing is also what
 * keeps the UI usable for anyone who cannot separate two hues — the colour is
 * an accent on the name, never the thing carrying the meaning.
 */
export function ColorDot({
  color,
  className,
}: {
  color: ColorSource;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const swatch = resolveColor(color, resolvedTheme);

  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: swatch.solid }}
    />
  );
}

/**
 * A badge tinted by a stored colour token.
 *
 * Deliberately not built on the ShadCN `Badge` variants: those encode a fixed
 * semantic set (success, warning, destructive) chosen at build time, and these
 * colours are chosen by users at runtime. The two systems coexist — `Badge`
 * still covers fixed states like "archived".
 *
 * A tint plus readable text rather than a saturated fill, so a list of thirty
 * rows reads as a list rather than a set of alarms.
 */
export function SemanticBadge({
  color,
  children,
  icon,
  className,
}: {
  color: ColorSource;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const swatch = resolveColor(color, resolvedTheme);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{ backgroundColor: swatch.surface, color: swatch.onSurface }}
    >
      {icon ?? <ColorDot color={color} />}
      {children}
    </span>
  );
}
