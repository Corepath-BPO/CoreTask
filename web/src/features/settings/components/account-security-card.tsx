import type { AuthUser } from '@coretask/types';
import { changePasswordFormSchema, type ChangePasswordFormInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, MailCheck, MailWarning, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authApi } from '@/features/auth/api/auth.api';
import { PasswordInput } from '@/features/auth/components/password-input';
import { useResendVerification } from '@/features/auth/hooks/use-email-verification';
import { ApiError } from '@/lib/api/api-error';
import { formatDate } from '@/lib/utils/format';

import {
  useCancelEmailChange,
  usePendingEmailChange,
  useTwoFactorStatus,
} from '../hooks/use-account-security';

import { ChangeEmailDialog } from './change-email-dialog';
import {
  RecoveryCodesDialog,
  TwoFactorDisableDialog,
  TwoFactorSetupDialog,
} from './two-factor-dialogs';

type OpenDialog = 'password' | 'email' | 'two-factor-on' | 'two-factor-off' | 'recovery' | null;

/**
 * Asana's "Account" settings, the parts that are about getting in: the
 * address and whether it is confirmed, the password, and two-step
 * verification. Sessions have their own card.
 */
export function AccountSecurityCard({ user }: { user: AuthUser }) {
  const resend = useResendVerification();
  const pending = usePendingEmailChange();
  const cancelChange = useCancelEmailChange();
  const twoFactor = useTwoFactorStatus();
  const [open, setOpen] = useState<OpenDialog>(null);

  // An account that signs in only with SSO sets its first password the way a
  // forgotten one is reset: by a link to the address, which proves it is theirs.
  const setPassword = useMutation({
    mutationFn: () => authApi.forgotPassword(user.email),
    onSuccess: () => toast.success(`We sent a link to ${user.email} to set your password.`),
    onError: () => toast.error('Could not send the link. Try again in a moment.'),
  });

  const dialog = (name: Exclude<OpenDialog, null>) => ({
    open: open === name,
    onOpenChange: (next: boolean) => setOpen(next ? name : null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in and security</CardTitle>
        <CardDescription>Your e-mail address, password and two-step verification.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-1">
        <section aria-label="E-mail address" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">{user.email}</p>
              {user.emailVerified ? (
                <Badge variant="outline" className="gap-1">
                  <MailCheck className="size-3" aria-hidden="true" />
                  Confirmed
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1">
                  <MailWarning className="size-3" aria-hidden="true" />
                  Not confirmed
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!user.emailVerified && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={resend.isPending}
                  onClick={() => resend.mutate()}
                >
                  Send confirmation link
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setOpen('email')}>
                Change
              </Button>
            </div>
          </div>
          {!user.emailVerified && user.emailVerificationDueAt && (
            <p className="text-xs text-muted-foreground">
              Confirm it by {formatDate(user.emailVerificationDueAt)} to keep using CoreTask.
              Inviting people and connecting apps need a confirmed address.
            </p>
          )}
          {pending.data && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
              <p className="min-w-0">
                Waiting for you to open the link sent to{' '}
                <span className="font-medium">{pending.data.email}</span>.
              </p>
              <Button
                variant="ghost"
                size="sm"
                loading={cancelChange.isPending}
                onClick={() => cancelChange.mutate()}
              >
                Cancel change
              </Button>
            </div>
          )}
        </section>

        <section
          aria-label="Password"
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Password</p>
            <p className="text-xs text-muted-foreground">
              {user.hasPassword
                ? 'Changing it signs out your other devices.'
                : 'You sign in with Google, Microsoft or SSO. Set a password to sign in with it too.'}
            </p>
          </div>
          {user.hasPassword ? (
            <Button variant="outline" size="sm" onClick={() => setOpen('password')}>
              <KeyRound />
              Change password
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              loading={setPassword.isPending}
              onClick={() => setPassword.mutate()}
            >
              <KeyRound />
              Set a password
            </Button>
          )}
        </section>

        <section aria-label="Two-step verification" className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                Two-step verification
                {user.twoFactorEnabled ? (
                  <Badge variant="success" className="gap-1">
                    <ShieldCheck className="size-3" aria-hidden="true" />
                    On
                  </Badge>
                ) : (
                  <Badge variant="muted" className="gap-1">
                    <ShieldOff className="size-3" aria-hidden="true" />
                    Off
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {user.twoFactorEnabled
                  ? twoFactor.data
                    ? `Signing in asks for a code from your authenticator app. ${twoFactor.data.recoveryCodesRemaining} of 10 recovery codes left.`
                    : 'Signing in asks for a code from your authenticator app.'
                  : 'Ask for a code from an authenticator app as well, every time you sign in.'}
              </p>
            </div>
            {user.twoFactorEnabled ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen('recovery')}>
                  New recovery codes
                </Button>
                <Button variant="outline" size="sm" onClick={() => setOpen('two-factor-off')}>
                  Turn off
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => setOpen('two-factor-on')}>
                Turn on
              </Button>
            )}
          </div>
        </section>
      </CardContent>

      <ChangePasswordDialog {...dialog('password')} />
      <ChangeEmailDialog {...dialog('email')} user={user} />
      <TwoFactorSetupDialog {...dialog('two-factor-on')} />
      <TwoFactorDisableDialog {...dialog('two-factor-off')} user={user} />
      <RecoveryCodesDialog {...dialog('recovery')} user={user} />
    </Card>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormInput>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const change = useMutation({
    mutationFn: (values: ChangePasswordFormInput) =>
      authApi.changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      toast.success('Password changed. Your other devices were signed out.');
      close(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CURRENT_PASSWORD_INCORRECT') {
        setError('currentPassword', { message: error.message });
      }
    },
  });

  function close(next: boolean) {
    if (!next) {
      reset();
      change.reset();
    }
    onOpenChange(next);
  }

  const onSubmit = handleSubmit(async (values) => {
    await change.mutateAsync(values).catch(() => undefined);
  });

  const busy = isSubmitting || change.isPending;
  const submitError =
    change.error instanceof ApiError
      ? change.error.code === 'CURRENT_PASSWORD_INCORRECT'
        ? null
        : change.error.message
      : change.error
        ? 'Something went wrong. Please try again.'
        : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Your other devices are signed out. This one stays signed in.
          </DialogDescription>
        </DialogHeader>

        <form id="change-password" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={submitError} />
          <Field
            label="Current password"
            htmlFor="currentPassword"
            error={errors.currentPassword?.message}
            required
          >
            <PasswordInput
              {...fieldAria('currentPassword', errors.currentPassword?.message)}
              {...register('currentPassword')}
              autoComplete="current-password"
              autoFocus
              disabled={busy}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="newPassword"
            error={errors.newPassword?.message}
            hint="At least 10 characters, with three of: lowercase, uppercase, a number, a symbol."
            required
          >
            <PasswordInput
              {...fieldAria('newPassword', errors.newPassword?.message)}
              {...register('newPassword')}
              autoComplete="new-password"
              disabled={busy}
            />
          </Field>
          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={errors.confirmPassword?.message}
            required
          >
            <PasswordInput
              {...fieldAria('confirmPassword', errors.confirmPassword?.message)}
              {...register('confirmPassword')}
              autoComplete="new-password"
              disabled={busy}
            />
          </Field>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="change-password" loading={busy}>
            Change password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
