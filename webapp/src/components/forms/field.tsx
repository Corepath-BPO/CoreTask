import type * as React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + error, wired for accessibility.
 *
 * The error is rendered in a live region and linked via `aria-describedby` on
 * the caller's input, so screen readers announce validation failures instead of
 * silently marking the field invalid.
 */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>

      {children}

      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className={cn('text-xs font-medium text-destructive', !error && 'sr-only')}
      >
        {error ?? ''}
      </p>
    </div>
  );
}
