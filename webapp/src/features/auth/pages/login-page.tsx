import { loginSchema, type LoginInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { FormError } from '@/components/feedback/form-error';
import { fieldAria } from '@/components/forms/field-aria';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/api-error';

import { isTwoFactorChallenge } from '../api/auth.api';
import { PasswordInput } from '../components/password-input';
import { SsoOptions } from '../components/sso-options';
import { TwoFactorStep } from '../components/two-factor-step';
import { useAuth } from '../hooks/use-auth';

export function LoginPage() {
  const navigate = useNavigate();
  // Read non-strictly rather than by route id. Addressing `/guest/login`
  // directly couples this page to where it sits in the route tree, and throws
  // during unmount when no match is active.
  const search: Partial<{ redirect: string; ssoError: string }> = useSearch({ strict: false });
  const redirect = search.redirect;
  const { login } = useAuth();
  // Set when the password was right and the account wants a code as well.
  const [challenge, setChallenge] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await login.mutateAsync(values);
    if (isTwoFactorChallenge(result)) {
      setChallenge(result.challenge);
      return;
    }
    await navigate({ to: redirect ?? '/', replace: true });
  });

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onVerified={() => navigate({ to: redirect ?? '/', replace: true })}
        onRestart={() => {
          setChallenge(null);
          login.reset();
          // The password goes back to blank: starting again means typing it again.
          resetField('password');
        }}
      />
    );
  }

  const submitError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || login.isPending;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to CoreTask</h1>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to continue to your workspace.
        </p>
      </div>

      <SsoOptions redirect={redirect} error={search.ssoError} />

      <FormError message={submitError} />

      {/* noValidate: Zod owns validation, so the browser's native bubbles do not
          compete with the accessible inline messages. */}
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

        <div className="space-y-2">
          <Field label="Password" htmlFor="password" error={errors.password?.message} required>
            {/* Words, not dots: a row of dots in an empty box reads as a password already typed. */}
            <PasswordInput
              {...fieldAria('password', errors.password?.message)}
              {...register('password')}
              autoComplete="current-password"
              placeholder="Your password"
              disabled={busy}
            />
          </Field>
          <div className="text-right">
            <Link
              to="/forgot-password"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button type="submit" className="w-full" loading={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New to CoreTask?{' '}
        <Link
          to="/register"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
