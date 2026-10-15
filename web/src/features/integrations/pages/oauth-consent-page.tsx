import type { OAuthAuthorizationRequest } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError } from '@/lib/api/api-error';

import { oauthApi } from '../api/oauth.api';

/** The authorization request, read from the standard query parameters a tool sends. */
function readRequest(search: string): OAuthAuthorizationRequest {
  const params = new URLSearchParams(search);
  const value = (name: string) => params.get(name) ?? undefined;
  return {
    clientId: value('client_id') ?? '',
    redirectUri: value('redirect_uri') ?? '',
    responseType: value('response_type') ?? 'code',
    ...(value('scope') ? { scope: value('scope') } : {}),
    state: value('state') ?? null,
    codeChallenge: value('code_challenge') ?? null,
    codeChallengeMethod: value('code_challenge_method') ?? null,
  };
}

/**
 * `/oauth/authorize`: where a tool sends a person to ask for access.
 *
 * Asks the API first whether the request is one it will honour — a known app,
 * a redirect URI it registered — and only then offers Allow. Until that check
 * passes the page sends nobody anywhere, so it cannot be used to bounce people
 * to an address of an attacker's choosing.
 *
 * It refuses to work inside a frame, so another site cannot dress it up and
 * trick a click onto Allow.
 */
export function OAuthConsentPage() {
  const request = useMemo(() => readRequest(window.location.search), []);
  const user = useAuthStore((state) => state.user);
  const framed = window.top !== window.self;

  const consent = useQuery({
    queryKey: ['oauth-consent', request],
    queryFn: () => oauthApi.consent(request),
    enabled: !framed,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (approve: boolean) => oauthApi.authorize({ ...request, approve }),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  if (framed) {
    return (
      <ConsentShell>
        <Problem message="For your safety, CoreTask can only be connected from its own window." />
      </ConsentShell>
    );
  }

  if (consent.isLoading) {
    return (
      <ConsentShell>
        <div role="status" className="space-y-3">
          <span className="sr-only">Checking the request</span>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      </ConsentShell>
    );
  }

  if (consent.error || !consent.data) {
    return (
      <ConsentShell>
        <Problem
          message={
            consent.error instanceof ApiError
              ? consent.error.message
              : 'This connection request could not be checked.'
          }
        />
      </ConsentShell>
    );
  }

  const { app, scopes, redirectHost } = consent.data;
  const busy = decide.isPending || decide.isSuccess;

  return (
    <ConsentShell>
      <CardHeader className="px-0 pt-0">
        <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-xl leading-snug">
          {/* The one question on the page, so a screen reader lands on it. */}
          <h1>Allow {app.name} to use your CoreTask account?</h1>
        </CardTitle>
        <CardDescription>
          By {app.publisher}
          {app.websiteUrl ? (
            <>
              {' · '}
              <a
                href={app.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {new URL(app.websiteUrl).host}
              </a>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0 text-sm">
        {app.description && <p className="text-muted-foreground">{app.description}</p>}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-1 font-medium">It will be able to</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {scopes.map((entry) => (
              <li key={entry.scope}>{entry.description}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          Signed in as {user?.email}. You will be sent back to <strong>{redirectHost}</strong>. You
          can disconnect it any time under Integrations › Connected apps.
        </p>
        {decide.error && (
          <p role="alert" className="text-sm text-destructive">
            {decide.error instanceof ApiError ? decide.error.message : 'Something went wrong.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" disabled={busy} onClick={() => decide.mutate(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => decide.mutate(true)}>
            Allow
          </Button>
        </div>
      </CardContent>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md p-6">{children}</Card>
    </main>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <div role="alert" className="space-y-3 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-destructive/10">
        <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />
      </div>
      <p className="font-medium">This app can’t be connected</p>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
