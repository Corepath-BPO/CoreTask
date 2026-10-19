import type { SlackInstallResult } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, Hash } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { slackApi } from '../api/slack.api';

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/**
 * `/integrations/slack/callback`: where Slack sends the admin back after
 * they allow the app. The code is finished here, with their session, rather
 * than on a server address Slack calls — that is what ties the install to
 * the person who started it. Posted once, even under React's double effects:
 * a code can only be used once.
 */
export function SlackCallbackPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const navigate = useNavigate();
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const sent = useRef(false);
  const code = params.get('code');
  const state = params.get('state');
  const refused = params.get('error');

  const complete = useMutation({
    mutationFn: () => slackApi.completeInstall({ code: code ?? '', state: state ?? '' }),
    onSuccess: async (result: SlackInstallResult) => {
      setActiveWorkspaceId(result.workspaceId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.slack.all(result.workspaceId) });
      void navigate({ to: '/integrations/slack', replace: true });
    },
  });

  useEffect(() => {
    if (sent.current || refused || !code || !state) return;
    sent.current = true;
    complete.mutate();
  }, [code, state, refused, complete]);

  if (refused || !code || !state) {
    return (
      <ReturnShell>
        <Outcome
          ok={false}
          title="Slack was not connected"
          message={
            refused === 'access_denied'
              ? 'The app was not allowed in Slack, so nothing changed.'
              : 'Slack sent back an incomplete answer. Start again from Integrations › Slack.'
          }
        />
        <BackToSlackTab />
      </ReturnShell>
    );
  }

  if (complete.isError) {
    return (
      <ReturnShell>
        <Outcome
          ok={false}
          title="Slack was not connected"
          message={messageOf(complete.error, 'Something went wrong finishing the connection.')}
        />
        <BackToSlackTab />
      </ReturnShell>
    );
  }

  return (
    <ReturnShell>
      <div role="status" className="space-y-3 text-center">
        <Hash className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">Connecting Slack…</p>
        <Skeleton className="mx-auto h-4 w-40" />
      </div>
    </ReturnShell>
  );
}

/**
 * `/integrations/slack/link?token=`: the "Link your account" button from
 * Slack. Says which Slack workspace and which CoreTask person before doing
 * anything — whoever is signed in here is who Slack will act as.
 */
export function SlackLinkPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const user = useAuthStore((state) => state.user);

  const preview = useQuery({
    queryKey: ['slack-link', token],
    queryFn: () => slackApi.previewLink(token),
    enabled: token !== '',
    retry: false,
  });
  const link = useMutation({
    mutationFn: () => slackApi.link(token),
    onSuccess: (result) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.slack.all(result.workspaceId) }),
  });

  if (!token || preview.isError) {
    return (
      <ReturnShell>
        <Outcome
          ok={false}
          title="This link can’t be used"
          message={
            token
              ? messageOf(preview.error, 'The link could not be checked.')
              : 'The link is missing its token. In Slack, type /coretask link for a new one.'
          }
        />
      </ReturnShell>
    );
  }

  if (preview.isLoading || !preview.data) {
    return (
      <ReturnShell>
        <div role="status" className="space-y-3">
          <span className="sr-only">Checking the link</span>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      </ReturnShell>
    );
  }

  if (link.isSuccess) {
    return (
      <ReturnShell>
        <Outcome
          ok
          title="Linked"
          message={`Your account in ${link.data.teamName} is linked. Go back to Slack — what you do there is now done as you.`}
        />
      </ReturnShell>
    );
  }

  const { teamName, workspaceName, linkedTo } = preview.data;
  const replacing = linkedTo && linkedTo.id !== user?.id ? linkedTo : null;

  return (
    <ReturnShell>
      <div className="space-y-4">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
          <Hash className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold leading-snug">
          Link your Slack account in {teamName}?
        </h1>
        <p className="text-sm text-muted-foreground">
          Tasks you make and buttons you press in Slack will be done in {workspaceName} as{' '}
          <strong className="text-foreground">{user?.name}</strong> ({user?.email}), with your
          access.
        </p>
        {linkedTo?.id === user?.id && (
          <p className="text-sm text-muted-foreground">It is already linked to you.</p>
        )}
        {replacing && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
            This Slack account is linked to {replacing.name} now. Linking it to you replaces that.
          </p>
        )}
        {link.isError && (
          <p role="alert" className="text-sm text-destructive">
            {messageOf(link.error, 'Something went wrong.')}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" asChild>
            <Link to="/">Cancel</Link>
          </Button>
          <Button disabled={link.isPending} onClick={() => link.mutate()}>
            Link account
          </Button>
        </div>
      </div>
    </ReturnShell>
  );
}

function ReturnShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md space-y-4 p-6">{children}</Card>
    </main>
  );
}

function Outcome({ ok, title, message }: { ok: boolean; title: string; message: string }) {
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div role={ok ? 'status' : 'alert'} className="space-y-3 text-center">
      <div
        className={
          ok
            ? 'mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/12'
            : 'mx-auto flex size-11 items-center justify-center rounded-xl bg-destructive/10'
        }
      >
        <Icon className={ok ? 'size-5' : 'size-5 text-destructive'} aria-hidden="true" />
      </div>
      <h1 className="font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function BackToSlackTab() {
  return (
    <div className="flex justify-center">
      <Button variant="outline" asChild>
        <Link to="/integrations/slack">Back to Integrations › Slack</Link>
      </Button>
    </div>
  );
}
