import { loginSchema, type LoginInput } from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';

import { FormError } from '@/components/feedback/form-error';
import { fieldAria } from '@/components/forms/field-aria';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/api-error';

import { PasswordInput } from '../components/password-input';
import { useAuth } from '../hooks/use-auth';

export function LoginPage() {
  const navigate = useNavigate();
  // Read non-strictly rather than by route id. Addressing `/guest/login`
  // directly couples this page to where it sits in the route tree, and throws
  // during unmount when no match is active.
  const search: Partial<{ redirect: string }> = useSearch({ strict: false });
  const redirect = search.redirect;
  const { login } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  const onSubmit = handleSubmit(async (values) => {
    await login.mutateAsync(values);
    await navigate({ to: redirect ?? '/', replace: true });
  });

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

        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <PasswordInput
            {...fieldAria('password', errors.password?.message)}
            {...register('password')}
            autoComplete="current-password"
            placeholder="••••••••••"
            disabled={busy}
          />
        </Field>

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
