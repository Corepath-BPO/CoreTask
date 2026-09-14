import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface CopyMessages {
  success?: string;
  failure?: string;
}

const FALLBACK_FAILURE = 'Could not copy — select the text and copy it manually.';

/**
 * Copies text and reports the outcome.
 *
 * `navigator.clipboard` is undefined on a plain-http LAN address and can reject
 * when the document is not focused, so both are reported as a failure toast
 * rather than left to throw. `copied` flips back after `resetMs` so a button
 * can show "Copied" briefly.
 */
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string, messages: CopyMessages = {}): Promise<boolean> => {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;

      if (!clipboard?.writeText) {
        toast.error(messages.failure ?? FALLBACK_FAILURE);
        return false;
      }

      try {
        await clipboard.writeText(text);
      } catch {
        toast.error(messages.failure ?? FALLBACK_FAILURE);
        return false;
      }

      if (messages.success) toast.success(messages.success);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
      return true;
    },
    [resetMs],
  );

  return { copy, copied };
}
