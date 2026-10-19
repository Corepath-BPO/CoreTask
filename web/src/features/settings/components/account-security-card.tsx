import type { AuthUser } from '@coretask/types';
import { changePasswordFormSchema, type ChangePasswordFormInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, LogOut, MailCheck, MailWarning } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
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
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useResendVerification } from '@/features/auth/hooks/use-email-verification';
import { ApiError } from '@/lib/api/api-error';

/**
 * Asana's "Account" settings, the parts that are about getting in: whether the
 * address is confirmed, the password, and signing out on every device.
 */
export function AccountSecurityCard({ user }: { user: AuthUser }) {
  const resend = useResendVerification();
  const { logoutEverywhere } = useAuth();
  const [changing, setChanging] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in and security</CardTitle>
        <CardDescription>Your e-mail address, password and sessions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
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
        </div>

        <div className="grid gap-2 border-t pt-4">
          <Button variant="outline" className="justify-start" onClick={() => setChanging(true)}>
            <KeyRound />
            Change password
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => setConfirmingSignOut(true)}
          >
            <LogOut />
            Sign out everywhere
          </Button>
        </div>
      </CardContent>

      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />

      <AlertDialog open={confirmingSignOut} onOpenChange={setConfirmingSignOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              Every device and browser signed in to your account is signed out, this one included.
              Anything already open stops working within 15 minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => logoutEverywhere.mutate()}>
              Sign out everywhere
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
