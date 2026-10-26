import { resetPasswordFormSchema, type ResetPasswordFormInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { useAuthStore } from '@/stores/auth.store';

import { authApi } from '../api/auth.api';
import { PasswordInput } from '../components/password-input';

/**
 * Takes the token out of the address bar as soon as it is read, so it is not
 * left in the history or shown over someone's shoulder. Read once per page load.
 */
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
 * `/reset-password`: where the e-mailed link lands. Sets the new password and,
 * because the API signs the account out everywhere, forgets this tab's session
 * too before sending the person to sign in.
 */
export function ResetPasswordPage() {
  const [token] = useState(takeToken);
  const clearSession = useAuthStore((state) => state.clear);
  const reset = useMutation({
    mutationFn: (password: string) => authApi.resetPassword(token, password),
    onSuccess: () => clearSession(),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    await reset.mutateAsync(values.password).catch(() => undefined);
  });

  if (!token) {
    return (
      <ResetShell>
        <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="text-sm text-muted-foreground">
          Open the link from the e-mail again, or ask for a new one.
        </p>
        <Button asChild className="w-full">
          <Link to="/forgot-password">Ask for a new link</Link>
        </Button>
      </ResetShell>
    );
  }

  if (reset.isSuccess) {
    return (
      <ResetShell>
        <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
        <p className="text-sm text-muted-foreground">
          You have been signed out everywhere. Sign in with your new password.
        </p>
        <Button asChild className="w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </ResetShell>
    );
  }

  const expired = reset.error instanceof ApiError && reset.error.code === 'PASSWORD_RESET_INVALID';
  const submitError =
    reset.error instanceof ApiError
      ? reset.error.message
      : reset.error
        ? 'Something went wrong. Please try again.'
        : null;
  const busy = isSubmitting || reset.isPending;

  return (
    <ResetShell>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          At least 10 characters, with three of: lowercase, uppercase, a number, a symbol.
        </p>
      </div>

      <FormError message={submitError} />
      {expired && (
        <Link
          to="/forgot-password"
          className="block text-sm font-medium underline-offset-4 hover:underline"
        >
          Ask for a new link
        </Link>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="New password" htmlFor="password" error={errors.password?.message} required>
          <PasswordInput
            {...fieldAria('password', errors.password?.message)}
            {...register('password')}
            autoComplete="new-password"
            placeholder="Your new password"
            autoFocus
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
            placeholder="The same again"
            disabled={busy}
          />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </ResetShell>
  );
}

function ResetShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
          <KeyRound className="size-5" aria-hidden="true" />
        </div>
        {children}
      </div>
    </main>
  );
}
