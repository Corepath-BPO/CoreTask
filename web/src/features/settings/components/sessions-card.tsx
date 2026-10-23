import { SignInMethod } from '@coretask/contracts';
import type { AccountSession } from '@coretask/types';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { formatRelativeTime } from '@/lib/utils/format';

import {
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
} from '../hooks/use-account-security';
import { describeUserAgent } from '../lib/user-agent';

const METHOD_LABEL: Record<AccountSession['method'], string | null> = {
  [SignInMethod.PASSWORD]: null,
  [SignInMethod.GOOGLE]: 'Google',
  [SignInMethod.MICROSOFT]: 'Microsoft',
  [SignInMethod.SAML]: 'SSO',
};

/**
 * Every browser and device signed in to the account, with a way to sign any
 * of them out. Signing one out takes effect at its very next request.
 */
export function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const { logoutEverywhere } = useAuth();
  const [confirming, setConfirming] = useState<'others' | 'everywhere' | null>(null);

  const list = sessions.data ?? [];
  const others = list.filter((session) => !session.current).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you are signed in</CardTitle>
        <CardDescription>
          Sign out anything you do not recognise, then change your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {sessions.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sessions.isError ? (
          <p className="text-sm text-muted-foreground">Could not load your sessions.</p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Sessions">
            {list.map((session) => {
              const device = describeUserAgent(session.userAgent);
              const mobile = /iPhone|iPad|Android/.test(device);
              const DeviceIcon = mobile ? Smartphone : Monitor;
              const method = METHOD_LABEL[session.method];
              return (
                <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
                  <DeviceIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {device}
                      {session.current && <Badge variant="success">This device</Badge>}
                      {method && <Badge variant="outline">{method}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        session.ipAddress,
                        session.current
                          ? 'Active now'
                          : `Active ${formatRelativeTime(session.lastActiveAt)}`,
                        `signed in ${formatRelativeTime(session.signedInAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {!session.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Sign out ${device}`}
                      loading={revoke.isPending && revoke.variables === session.id}
                      onClick={() => revoke.mutate(session.id)}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            disabled={others === 0}
            loading={revokeOthers.isPending}
            onClick={() => setConfirming('others')}
          >
            Sign out other sessions
          </Button>
          <Button variant="outline" onClick={() => setConfirming('everywhere')}>
            <LogOut />
            Sign out everywhere
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === 'others' ? 'Sign out other sessions?' : 'Sign out everywhere?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === 'others'
                ? 'Every other device and browser is signed out at once. This one stays signed in.'
                : 'Every device and browser signed in to your account is signed out at once, this one included.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirming === 'others' ? revokeOthers.mutate() : logoutEverywhere.mutate()
              }
            >
              {confirming === 'others' ? 'Sign out others' : 'Sign out everywhere'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
