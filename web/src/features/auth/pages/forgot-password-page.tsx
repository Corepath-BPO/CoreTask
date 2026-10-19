import { forgotPasswordSchema, type ForgotPasswordInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/api-error';

import { authApi } from '../api/auth.api';

/**
 * "Forgot password": asks for the address and says the same thing whether or
 * not it has an account — as the API does — so the page cannot be used to
 * find out who is registered.
 */
export function ForgotPasswordPage() {
  const send = useMutation({ mutationFn: (email: string) => authApi.forgotPassword(email) });

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    await send.mutateAsync(values.email).catch(() => undefined);
  });

  if (send.isSuccess) {
    return (
      <div className="space-y-6">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
          <MailCheck className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Check your e-mail</h1>
          <p className="text-sm text-muted-foreground">
            If <strong className="text-foreground">{getValues('email')}</strong> has a CoreTask
            account, a link to choose a new password is on its way. It works once, for an hour.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check spam, or{' '}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline"
            onClick={() => send.reset()}
          >
            try again
          </button>{' '}
          in a minute.
        </p>
        <BackToSignIn />
      </div>
    );
  }

  const submitError =
    send.error instanceof ApiError
      ? send.error.message
      : send.error
        ? 'Something went wrong. Please try again.'
        : null;
  const busy = isSubmitting || send.isPending;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter the e-mail address you sign in with, and we will send you a link to choose a new
          password.
        </p>
      </div>

      <FormError message={submitError} />

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" htmlFor="email" error={errors.email?.message} required>
          <Input
            {...fieldAria('email', errors.email?.message)}
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus
            disabled={busy}
          />
        </Field>

        <Button type="submit" className="w-full" loading={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>

      <BackToSignIn />
    </div>
  );
}

function BackToSignIn() {
  return (
    <p className="text-center text-sm text-muted-foreground">
      Remembered it?{' '}
      <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
        Sign in
      </Link>
    </p>
  );
}
