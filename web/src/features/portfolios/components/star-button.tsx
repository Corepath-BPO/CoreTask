import { Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Portfolio } from '@/stores/portfolio.store';

interface StarButtonProps {
  portfolio: Portfolio;
  onToggleStar: () => void;
  className?: string;
}

export function StarButton({ portfolio, onToggleStar, className }: StarButtonProps) {
  const starred = portfolio.starred ?? false;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={starred ? `Unstar ${portfolio.name}` : `Star ${portfolio.name}`}
      aria-pressed={starred}
      onClick={onToggleStar}
      className={className}
    >
      <Star className={cn(starred && 'fill-amber-400 text-amber-400')} />
    </Button>
  );
}
