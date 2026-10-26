import type { ConfirmEmailChangeResult } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useAuthStore } from '@/stores/auth.store';

import { authApi } from '../api/auth.api';

/** Reads the token and takes it out of the address bar, as the reset page does. */
function takeToken(): string {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  if (token) {
    params.delete('token');
    const rest = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}`,
    );
  }
  return token;
}

/**
 * `/confirm-email-change`: where the link sent to a new address lands. Like
 * the confirmation page it acts on arrival and works signed in or not — the
 * new inbox may well be on another device.
 */
export function ConfirmEmailChangePage() {
  const [token] = useState(takeToken);
  const signedIn = useAuthStore((state) => state.status === 'authenticated');
  const started = useRef(false);
  const [outcome, setOutcome] = useState<
    | { status: 'pending' }
    | { status: 'done'; result: ConfirmEmailChangeResult }
    | { status: 'failed'; error: unknown }
  >({ status: 'pending' });

  // Once per page load: the link works once (see the confirmation page).
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    authApi.confirmEmailChange(token).then(
      (result) => {
        const { user, setUser } = useAuthStore.getState();
        if (user) {
          setUser({
            ...user,
            email: result.email,
            emailVerified: true,
            emailVerificationDueAt: null,
          });
        }
        queryClient.setQueryData(queryKeys.auth.emailChange, null);
        setOutcome({ status: 'done', result });
      },
      (error: unknown) => setOutcome({ status: 'failed', error }),
    );
  }, [token]);

  const onward = signedIn ? (
    <Button asChild className="w-full">
      <Link to="/settings">Back to Settings</Link>
    </Button>
  ) : (
    <Button asChild className="w-full">
      <Link to="/login">Sign in</Link>
    </Button>
  );

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6" aria-live="polite">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
          <MailCheck className="size-5" aria-hidden="true" />
        </div>
        {!token ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
            <p className="text-sm text-muted-foreground">
              Open the link from the e-mail again, or ask for a new one from Settings.
            </p>
            {onward}
          </>
        ) : outcome.status === 'done' ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Your address is changed</h1>
            <p className="text-sm text-muted-foreground">
              Sign in with {outcome.result.email} from now on.
            </p>
            {onward}
          </>
        ) : outcome.status === 'failed' ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">We could not change it</h1>
            <p className="text-sm text-muted-foreground">
              {outcome.error instanceof ApiError
                ? outcome.error.message
                : 'Something went wrong. Please try again.'}
            </p>
            {onward}
          </>
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">Changing your address…</h1>
        )}
      </div>
    </main>
  );
}
