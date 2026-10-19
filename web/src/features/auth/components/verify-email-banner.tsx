import { MailWarning, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/stores/auth.store';

import { useResendVerification } from '../hooks/use-email-verification';

const dismissedKey = (userId: string) => `coretask:verify-email-dismissed:${userId}`;

/** Session storage can be missing or refuse writes (private windows); neither is an error. */
function readDismissed(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(dismissedKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(userId: string): void {
  try {
    window.sessionStorage.setItem(dismissedKey(userId), '1');
  } catch {
    // Dismissed for this page view only.
  }
}

/**
 * A quiet reminder while the address is unconfirmed. Dismissing it lasts for
 * this browser session, so it comes back next time rather than never; it goes
 * for good once the address is confirmed.
 */
export function VerifyEmailBanner() {
  const user = useCurrentUser();
  const resend = useResendVerification();
  const [dismissed, setDismissed] = useState(() => (user ? readDismissed(user.id) : false));

  if (!user || user.emailVerified || dismissed) return null;

  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm"
    >
      <MailWarning className="size-4 shrink-0 text-warning-strong" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Confirm your e-mail address, <span className="font-medium">{user.email}</span>, so we know
        it reaches you.
      </p>
      <Button
        variant="outline"
        size="sm"
        loading={resend.isPending}
        onClick={() => resend.mutate()}
      >
        Send confirmation link
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label="Dismiss"
        onClick={() => {
          writeDismissed(user.id);
          setDismissed(true);
        }}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
