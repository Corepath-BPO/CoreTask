import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { CopyButton } from '@/components/common/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SecretRevealProps {
  secret: string;
  /** What it is, for the label and the button names: "API key". */
  label: string;
  id?: string;
}

/**
 * Shows a secret exactly once.
 *
 * Masked by default — people create keys while screen-sharing — through a real
 * `type="password"` input, so the value is still there to select and copy by
 * hand when the clipboard API is unavailable. Copy always copies the raw value.
 */
export function SecretReveal({ secret, label, id = 'secret-reveal' }: SecretRevealProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          type={visible ? 'text' : 'password'}
          value={secret}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </Button>
        <CopyButton value={secret} label={`Copy ${label}`} size="icon" />
      </div>
    </div>
  );
}
