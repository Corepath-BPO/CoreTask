import { Check, Copy } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';

interface CopyButtonProps {
  value: string;
  /** Accessible name — say what is copied: "Copy API key". */
  label: string;
  successMessage?: string;
  size?: 'sm' | 'icon' | 'icon-sm';
  variant?: React.ComponentProps<typeof Button>['variant'];
  className?: string;
}

/** Copies `value`; shows a tick for a moment afterwards so the click is seen to land. */
export function CopyButton({
  value,
  label,
  successMessage = 'Copied',
  size = 'icon-sm',
  variant = 'outline',
  className,
}: CopyButtonProps) {
  const { copy, copied } = useCopyToClipboard();
  const iconOnly = size !== 'sm';

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={label}
      onClick={() => void copy(value, { success: successMessage })}
    >
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {!iconOnly && <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>}
    </Button>
  );
}
