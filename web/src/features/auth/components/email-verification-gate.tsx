import type { AuthUser } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ChangeEmailDialog } from '@/features/settings/components/change-email-dialog';
import { useAuthStore } from '@/stores/auth.store';

import { authApi } from '../api/auth.api';
import { useAuth } from '../hooks/use-auth';
import { useResendVerification } from '../hooks/use-email-verification';

/**
 * Shown instead of the app once an unconfirmed address is past its deadline.
 * The API refuses everything else by then, so this says why and offers the
 * three ways out: a new link, a corrected address, or signing out.
 */
export function EmailVerificationGate({ user }: { user: AuthUser }) {
  const resend = useResendVerification();
  const { signOut } = useAuth();
  const setUser = useAuthStore((state) => state.setUser);
  const [changing, setChanging] = useState(false);

  // "I've confirmed it" — the link may have been opened on another device.
  const recheck = useMutation({
    mutationFn: () => authApi.me(),
    onSuccess: (fresh) => {
      setUser(fresh);
      if (!fresh.emailVerified)
        toast.error('It is not confirmed yet. Open the link in the e-mail.');
    },
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex size-11 items-center justify-center rounded-xl bg-warning/15 ring-1 ring-warning/30">
          <MailWarning className="size-5 text-warning-strong" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Confirm your e-mail address</h1>
          <p className="text-sm text-muted-foreground">
            To keep using CoreTask, confirm that{' '}
            <span className="font-medium text-foreground">{user.email}</span> is yours. Open the
            link we sent there, or send a new one.
          </p>
        </div>
        <div className="grid gap-2">
          <Button loading={resend.isPending} onClick={() => resend.mutate()}>
            Send a new link
          </Button>
          <Button variant="outline" loading={recheck.isPending} onClick={() => recheck.mutate()}>
            I have confirmed it
          </Button>
          <Button variant="ghost" onClick={() => setChanging(true)}>
            That address is wrong — change it
          </Button>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Not you?{' '}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline"
            onClick={signOut}
          >
            Sign out
          </button>
        </p>
      </div>
      <ChangeEmailDialog open={changing} onOpenChange={setChanging} user={user} />
    </main>
  );
}
