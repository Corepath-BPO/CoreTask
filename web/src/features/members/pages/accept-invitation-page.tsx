import { Link, useNavigate } from '@tanstack/react-router';
import { MailCheck, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { humanizeEnum } from '@/lib/utils';
import { useAuthStatus, useCurrentUser } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { useAcceptInvitation, useInvitationPreview } from '../hooks/use-invitations';

/**
 * Landing page for an invitation link.
 *
 * Reachable signed out on purpose: the usual recipient has no account yet, and
 * being told *which* workspace invited them is what makes signing up worth it.
 * The preview endpoint is public and deliberately thin, so nothing about the
 * workspace's contents is exposed to whoever holds the link.
 */
export function AcceptInvitationPage({ token }: { token: string }) {
  const status = useAuthStatus();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  const { data: invitation, isLoading, isError } = useInvitationPreview(token);
  const accept = useAcceptInvitation();

  const redirectTo = `/invitations/${token}`;

  if (isLoading) {
    return (
      <Centered>
        <Skeleton className="h-40 w-full" />
      </Centered>
    );
  }

  if (isError || !invitation) {
    return (
      <Centered>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />
              This invitation is no longer valid
            </CardTitle>
            <CardDescription>
              It may have been revoked, already used, or simply expired. Ask whoever invited you to
              send a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/">Go to CoreTask</Link>
            </Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  const signedInAs = currentUser?.email.toLowerCase();
  const wrongAccount = status === 'authenticated' && signedInAs !== invitation.email.toLowerCase();

  const onAccept = () => {
    accept.mutate(token, {
      onSuccess: async (result) => {
        // Select the workspace they just joined, so landing on the dashboard
        // shows the thing they were invited to rather than whatever was last
        // active.
        setActiveWorkspaceId(result.workspaceId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
        await navigate({ to: '/' });
      },
    });
  };

  return (
    <Centered>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="size-5" aria-hidden="true" />
            Join {invitation.workspaceName}
          </CardTitle>
          <CardDescription>
            {invitation.invitedByName ?? 'Someone'} invited{' '}
            <span className="font-medium text-foreground">{invitation.email}</span> to join as a{' '}
            {humanizeEnum(invitation.role).toLowerCase()}.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status === 'anonymous' && (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in as {invitation.email} to accept, or create an account with that address.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/login" search={{ redirect: redirectTo }}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/register" search={{ redirect: redirectTo }}>
                    Create an account
                  </Link>
                </Button>
              </div>
            </>
          )}

          {wrongAccount && (
            <>
              <p className="text-sm text-destructive">
                You are signed in as {currentUser?.email}. This invitation was sent to{' '}
                {invitation.email}, so it can only be accepted by that account.
              </p>
              <Button asChild variant="outline">
                <Link to="/">Back to CoreTask</Link>
              </Button>
            </>
          )}

          {status === 'authenticated' && !wrongAccount && (
            <Button onClick={onAccept} loading={accept.isPending}>
              {accept.isPending ? 'Joining…' : `Join ${invitation.workspaceName}`}
            </Button>
          )}
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh max-w-lg items-center px-4 py-10">
      <div className="w-full">{children}</div>
    </main>
  );
}
