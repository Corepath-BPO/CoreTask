import { PASSWORD_MIN_LENGTH } from '@coretask/contracts';
import { registerFormSchema, type RegisterFormInput } from '@coretask/validation';
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

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();

  /*
   * Both of these arrive when someone reaches signup from an invitation.
   *
   * `redirect` takes them back to the invitation once the account exists —
   * without it they finish on the dashboard and the invitation is silently
   * abandoned. `email` prefills the invited address, because an invitation can
   * only be accepted by the account it was addressed to, so registering a
   * different one strands them with an account they cannot use to accept.
   */
  const search: Partial<{ redirect: string; email: string }> = useSearch({ strict: false });
  const invitedEmail = search.email ?? '';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormInput>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      name: '',
      email: invitedEmail,
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
    mode: 'onSubmit',
  });

  const onSubmit = handleSubmit(async (values) => {
    await registerUser.mutateAsync({
      name: values.name,
      email: values.email,
      password: values.password,
    });
    await navigate({ to: search.redirect ?? '/', replace: true });
  });

  const submitError =
    registerUser.error instanceof ApiError
      ? registerUser.error.message
      : registerUser.error
        ? 'Something went wrong. Please try again.'
        : null;

  const busy = isSubmitting || registerUser.isPending;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Start organising work in minutes. No credit card required.
        </p>
      </div>

      <FormError message={submitError} />

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Full name" htmlFor="name" error={errors.name?.message} required>
          <Input
            {...fieldAria('name', errors.name?.message)}
            {...register('name')}
            autoComplete="name"
            placeholder="Ada Lovelace"
            autoFocus
            disabled={busy}
          />
        </Field>

        <Field label="Work email" htmlFor="email" error={errors.email?.message} required>
          <Input
            {...fieldAria('email', errors.email?.message)}
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            disabled={busy}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters, using three of: lowercase, uppercase, number, symbol.`}
          required
        >
          <PasswordInput
            {...fieldAria(
              'password',
              errors.password?.message,
              `At least ${PASSWORD_MIN_LENGTH} characters.`,
            )}
            {...register('password')}
            autoComplete="new-password"
            placeholder="••••••••••"
            disabled={busy}
          />
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
          required
        >
          <PasswordInput
            {...fieldAria('confirmPassword', errors.confirmPassword?.message)}
            {...register('confirmPassword')}
            autoComplete="new-password"
            placeholder="••••••••••"
            disabled={busy}
          />
        </Field>

        <div className="space-y-2">
          <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <input
              {...register('acceptTerms')}
              id="acceptTerms"
              type="checkbox"
              disabled={busy}
              aria-invalid={Boolean(errors.acceptTerms) || undefined}
              className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
            <span>I agree to the CoreTask terms of service and privacy policy.</span>
          </label>
          <p role="alert" className="text-xs font-medium text-destructive">
            {errors.acceptTerms?.message ?? ''}
          </p>
        </div>

        <Button type="submit" className="w-full" loading={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
