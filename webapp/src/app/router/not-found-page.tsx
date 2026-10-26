import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <Compass className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">404</p>
          <h1 className="text-xl font-semibold tracking-tight">This page does not exist</h1>
          <p className="text-sm text-muted-foreground">
            The link may be outdated, or the resource may have been moved or archived.
          </p>
        </div>

        <Button asChild>
          <Link to="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
