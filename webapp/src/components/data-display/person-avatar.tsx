import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { colorForName } from '@/features/colors/lib/color-for-name';
import { resolveColorToken } from '@/features/colors/lib/color-tokens';
import { initials } from '@/lib/utils';
import { useTheme } from '@/stores/theme.store';

/**
 * A person's avatar: their photo when there is one, a coloured monogram when
 * not.
 *
 * The colour is hashed from the name — see `colorForName` — so one person
 * looks the same in every row, card and dialog. A tint behind readable text
 * rather than a saturated fill, from the same contrast-checked palette as
 * user-chosen colours, so a column of avatars reads as people rather than
 * alerts.
 */
export function PersonAvatar({
  name,
  avatarUrl,
  className,
  fallbackClassName,
  title,
}: {
  name: string;
  avatarUrl?: string | null | undefined;
  className?: string;
  /** Sizes the monogram to the avatar, e.g. `text-[9px]` on a `size-5`. */
  fallbackClassName?: string;
  title?: string;
}) {
  const { resolvedTheme } = useTheme();
  const swatch = resolveColorToken(colorForName(name), resolvedTheme);

  return (
    <Avatar className={className} {...(title === undefined ? {} : { title })}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback
        className={fallbackClassName}
        style={{ backgroundColor: swatch.surface, color: swatch.onSurface }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
