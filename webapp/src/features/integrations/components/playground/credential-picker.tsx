import { API_KEY_PREFIX } from '@coretask/contracts';
import { Eye, EyeOff, KeyRound, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Who the playground runs as. The key is held in memory only; see the page. */
export type CredentialChoice = { kind: 'session' } | { kind: 'api-key'; key: string };

interface CredentialPickerProps {
  value: CredentialChoice;
  onChange: (next: CredentialChoice) => void;
}

/**
 * "Run as me" or "run as a key". The key path is the one that matters — it is
 * what n8n will see, badge and permissions included — but the session path
 * means the page works before anyone has created a key.
 */
export function CredentialPicker({ value, onChange }: CredentialPickerProps) {
  const [shown, setShown] = useState(false);
  const usingKey = value.kind === 'api-key';

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Run as" className="grid grid-cols-2 gap-2">
        <ChoiceButton
          selected={!usingKey}
          icon={<UserRound className="size-4" aria-hidden="true" />}
          title="Me"
          detail="My signed-in session"
          onClick={() => onChange({ kind: 'session' })}
        />
        <ChoiceButton
          selected={usingKey}
          icon={<KeyRound className="size-4" aria-hidden="true" />}
          title="An API key"
          detail="Exactly what n8n sees"
          onClick={() => onChange({ kind: 'api-key', key: usingKey ? value.key : '' })}
        />
      </div>

      {usingKey && (
        <Field
          label="API key"
          htmlFor="playground-api-key"
          hint="Kept only in this browser tab, never saved. Create one on the API keys tab."
        >
          <div className="flex gap-2">
            <Input
              id="playground-api-key"
              type={shown ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={`${API_KEY_PREFIX}…`}
              value={value.key}
              onChange={(event) => onChange({ kind: 'api-key', key: event.target.value })}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={shown ? 'Hide API key' : 'Show API key'}
              aria-pressed={shown}
              onClick={() => setShown((current) => !current)}
            >
              {shown ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </Field>
      )}
    </div>
  );
}

function ChoiceButton({
  selected,
  icon,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        selected
          ? 'border-primary/60 bg-primary/5'
          : 'border-border hover:border-border/80 hover:bg-muted/40',
      )}
    >
      <span className={cn('mt-0.5', selected ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
