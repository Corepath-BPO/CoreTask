import type { ProjectMemberPreview } from '@coretask/types';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { cn } from '@/lib/utils';

const SHOWN = 3;

interface ProjectMembersStackProps {
  /** The summary's preview — admins first, never the whole roster. */
  members: ProjectMemberPreview[];
  memberCount: number;
  /** Drawn first when present, so the person running it is the face people see. */
  leadId?: string | null;
  size?: 'sm' | 'md';
  /** Given, the stack is a button that opens the Share dialog. */
  onClick?: (() => void) | undefined;
  className?: string;
}

/**
 * Overlapping avatars and a `+N`, from the preview every project summary
 * carries — no fetch of its own. The count is the summary's `memberCount`,
 * never the preview's length, which is capped.
 */
export function ProjectMembersStack({
  members,
  memberCount,
  leadId = null,
  size = 'md',
  onClick,
  className,
}: ProjectMembersStackProps) {
  const ordered = [...members].sort((a, b) =>
    a.user.id === leadId ? -1 : b.user.id === leadId ? 1 : 0,
  );
  const shown = ordered.slice(0, SHOWN);
  const overflow = Math.max(memberCount - shown.length, 0);
  const avatar = size === 'sm' ? 'size-6' : 'size-7';
  const monogram = size === 'sm' ? 'text-[9px]' : 'text-[10px]';
  const label = `${memberCount} member${memberCount === 1 ? '' : 's'}`;

  const faces =
    memberCount === 0 ? (
      <span className="text-sm text-muted-foreground">—</span>
    ) : (
      <span className="flex items-center -space-x-1.5">
        {shown.map((member) => (
          <PersonAvatar
            key={member.user.id}
            name={member.user.name}
            avatarUrl={member.user.avatarUrl}
            title={member.user.name}
            className={cn(avatar, 'ring-2 ring-background')}
            fallbackClassName={monogram}
          />
        ))}
        {overflow > 0 && (
          <span
            className={cn(
              avatar,
              monogram,
              'flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background',
            )}
          >
            +{overflow}
          </span>
        )}
      </span>
    );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}. Open sharing`}
        className={cn(
          'inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          className,
        )}
      >
        {faces}
      </button>
    );
  }

  return (
    <span role="group" aria-label={label} className={cn('inline-flex items-center', className)}>
      {faces}
    </span>
  );
}
