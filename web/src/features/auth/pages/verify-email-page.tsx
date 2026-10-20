import type { VerifyEmailResult } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
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
 * `/verify-email`: where the confirmation link lands. Confirms on arrival —
 * there is nothing to decide — and works whether or not this device is
 * signed in, since the link may be opened on a phone.
 */
export function VerifyEmailPage() {
  const [token] = useState(takeToken);
  const signedIn = useAuthStore((state) => state.status === 'authenticated');
  const started = useRef(false);
  const [outcome, setOutcome] = useState<
    | { status: 'pending' }
    | { status: 'done'; result: VerifyEmailResult }
    | { status: 'failed'; error: unknown }
  >({ status: 'pending' });

  // Once per page load: the link works once, so a second request (StrictMode's
  // double effect, say) would turn a success into "already used". Plain state
  // rather than a mutation: a mutation started from this effect confirmed the
  // address in the running app, but its answer never reached the page.
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    authApi.verifyEmail(token).then(
      (result) => {
        const { user, setUser } = useAuthStore.getState();
        if (user && user.email === result.email) setUser({ ...user, emailVerified: true });
        setOutcome({ status: 'done', result });
      },
      (error: unknown) => setOutcome({ status: 'failed', error }),
    );
  }, [token]);

  const onward = signedIn ? (
    <Button asChild className="w-full">
      <Link to="/">Go to CoreTask</Link>
    </Button>
  ) : (
    <Button asChild className="w-full">
      <Link to="/login">Sign in</Link>
    </Button>
  );

  if (!token) {
    return (
      <VerifyShell>
        <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="text-sm text-muted-foreground">
          Open the link from the e-mail again, or send a new one from Settings.
        </p>
        {onward}
      </VerifyShell>
    );
  }

  if (outcome.status === 'done') {
    return (
      <VerifyShell>
        <h1 className="text-2xl font-semibold tracking-tight">E-mail address confirmed</h1>
        <p className="text-sm text-muted-foreground">
          {outcome.result.email} is confirmed for your CoreTask account.
        </p>
        {onward}
      </VerifyShell>
    );
  }

  if (outcome.status === 'failed') {
    const message =
      outcome.error instanceof ApiError
        ? outcome.error.message
        : 'Something went wrong. Please try again.';
    return (
      <VerifyShell>
        <h1 className="text-2xl font-semibold tracking-tight">We could not confirm it</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {signedIn ? (
          <Button asChild className="w-full">
            <Link to="/settings">Send a new link from Settings</Link>
          </Button>
        ) : (
          onward
        )}
      </VerifyShell>
    );
  }

  return (
    <VerifyShell>
      <h1 className="text-2xl font-semibold tracking-tight">Confirming your address…</h1>
    </VerifyShell>
  );
}

function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6" aria-live="polite">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
          <MailCheck className="size-5" aria-hidden="true" />
        </div>
        {children}
      </div>
    </main>
  );
}
