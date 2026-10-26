import { Bot } from 'lucide-react';

import { cn } from '@/lib/utils';

interface IntegrationBadgeProps {
  className?: string;
}

/**
 * Marks something done through a workspace API key rather than by a person.
 *
 * The key's hidden service account has a name — "n8n", say — and shows it like
 * any author; this sits beside the name so nobody goes looking for a colleague
 * called n8n.
 */
export function IntegrationBadge({ className }: IntegrationBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground',
        className,
      )}
      title="Done through an API key, not by a person"
    >
      <Bot className="size-2.5" aria-hidden="true" />
      Integration
    </span>
  );
}
