import type { AuthUser } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/stores/auth.store';

import { authApi } from '../api/auth.api';

/**
 * "Send confirmation link". The server sends nothing when the address is already
 * confirmed or a link went out under a minute ago, and says which — so the
 * toast tells the person what actually happened rather than always "sent".
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
    onSuccess: (result) => {
      const { user, setUser } = useAuthStore.getState();

      if (result.emailVerified) {
        if (user && !user.emailVerified) {
          setUser({ ...user, emailVerified: true, emailVerificationDueAt: null });
        }
        toast.success('Your e-mail address is already confirmed.');
        return;
      }

      toast.success(
        result.sent
          ? `We sent a confirmation link to ${user?.email ?? 'your address'}.`
          : 'A link went out less than a minute ago. Check your inbox.',
      );
    },
    onError: () => toast.error('Could not send a new link. Try again in a moment.'),
  });
}

/** Whether the account's time to confirm its address has run out. */
export function useEmailVerificationOverdue(user: AuthUser | null): boolean {
  const due = user && !user.emailVerified ? user.emailVerificationDueAt : null;
  const [now, setNow] = useState(() => Date.now());

  // Re-render the moment the deadline passes, so an app left open closes on
  // time rather than at the next reload. Timers past ~24 days overflow, and a
  // deadline that far off will be re-read on some later load anyway.
  useEffect(() => {
    if (!due) return;
    const wait = Date.parse(due) - Date.now();
    if (wait <= 0 || wait > 86_400_000) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 1_000);
    return () => window.clearTimeout(timer);
  }, [due]);

  return due !== null && Date.parse(due) <= now;
}
