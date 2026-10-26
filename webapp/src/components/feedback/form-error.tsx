import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface FormErrorProps {
  message?: string | null;
  className?: string;
}

/** Form-level error banner (bad credentials, server failure). */
export function FormError({ message, className }: FormErrorProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
