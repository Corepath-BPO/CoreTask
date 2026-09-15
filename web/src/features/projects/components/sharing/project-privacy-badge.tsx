import { Lock } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Asana's padlock beside a private project's name. Icon only — the name is
 * already there, and a word would push it around in every row it sits in.
 */
export function ProjectPrivacyBadge({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label="Private project"
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-muted-foreground',
            className,
          )}
        >
          <Lock className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Private to members</TooltipContent>
    </Tooltip>
  );
}
