import * as React from 'react';

import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      // aria-hidden: a screen reader should hear the live region announce
      // "loading", not a pile of empty boxes.
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  );
}

export { Skeleton };
