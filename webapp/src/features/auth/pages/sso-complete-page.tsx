import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { FullPageLoader } from '@/components/feedback/loading';
import { useAuthStatus } from '@/stores/auth.store';

import { TwoFactorStep } from '../components/two-factor-step';
import { challengeFrom } from '../lib/sso';

/**
 * `/sso/complete`: where the API sends the browser back from Google,
 * Microsoft or a SAML provider.
 *
 * Either the API set the session cookie, and `AuthProvider` has already
 * exchanged it — it tries on this page whatever the session hint says — so
 * this only moves on; or the account has two-step verification and the
 * fragment carries the challenge, and the code is asked for here.
 *
 * This page never calls `/auth/refresh` itself: a second refresh racing
 * `AuthProvider`'s would present the same token twice, which reads as a
 * stolen token and signs the session out.
 */
export function SsoCompletePage() {
  const navigate = useNavigate();
  const search: Partial<{ redirect: string }> = useSearch({ strict: false });
  const hash = useRouterState({ select: (state) => state.location.hash });
  const status = useAuthStatus();
  const redirect = search.redirect ?? '/';
  // Read once: the fragment is cleared below, and the challenge must survive that.
  const [challenge] = useState(() => challengeFrom(hash));

  useEffect(() => {
    // Off the address bar and out of history: it is good for five minutes.
    if (challenge && window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, [challenge]);

  useEffect(() => {
    if (challenge) return;
    if (status === 'authenticated') {
      void navigate({ to: redirect, replace: true });
    } else if (status === 'anonymous') {
      // The cookie did not stick — blocked third-party cookies, most often.
      void navigate({ to: '/login', search: { ssoError: 'SSO_FAILED' }, replace: true });
    }
  }, [challenge, status, redirect, navigate]);

  if (!challenge) return <FullPageLoader label="Signing you in…" />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <TwoFactorStep
          challenge={challenge}
          onVerified={() => navigate({ to: redirect, replace: true })}
          onRestart={() =>
            navigate({
              to: '/login',
              search: redirect === '/' ? {} : { redirect },
              replace: true,
            })
          }
        />
      </div>
    </div>
  );
}
