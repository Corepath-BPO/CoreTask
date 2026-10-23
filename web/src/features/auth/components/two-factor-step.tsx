import type { AuthSession } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/api-error';
import { useAuthStore } from '@/stores/auth.store';

import { authApi } from '../api/auth.api';

/**
 * The second step of signing in, once the password (or Google, Microsoft or
 * SAML) has said who it is: a code from the authenticator app, or one of the
 * recovery codes. Shared by the sign-in page and the SSO return page.
 */
export function TwoFactorStep({
  challenge,
  onVerified,
  onRestart,
}: {
  challenge: string;
  /** Runs after the session is stored — navigate on from here. */
  onVerified: (session: AuthSession) => void | Promise<void>;
  /** Back to the start, when the challenge ran out. */
  onRestart: () => void;
}) {
  const setSession = useAuthStore((state) => state.setSession);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  const verify = useMutation({
    mutationFn: () => authApi.verifyTwoFactor({ challenge, code: code.trim() }),
    onSuccess: async (session) => {
      setSession(session);
      await onVerified(session);
    },
  });

  const expired =
    verify.error instanceof ApiError && verify.error.code === 'TWO_FACTOR_CHALLENGE_INVALID';
  const fieldError =
    verify.error instanceof ApiError && verify.error.code === 'TWO_FACTOR_CODE_INVALID'
      ? verify.error.message
      : undefined;
  const formError =
    verify.error && !fieldError
      ? verify.error instanceof ApiError
        ? verify.error.message
        : 'Something went wrong. Please try again.'
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <ShieldCheck className="size-5 text-primary-strong" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
        <p className="text-sm text-muted-foreground">
          {useRecovery
            ? 'Enter one of the recovery codes you saved when you turned this on. Each works once.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>

      <FormError message={formError} />

      {expired ? (
        <Button className="w-full" onClick={onRestart}>
          Start again
        </Button>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) verify.mutate();
          }}
        >
          <Field
            label={useRecovery ? 'Recovery code' : 'Code'}
            htmlFor="two-factor-code"
            error={fieldError}
            required
          >
            <Input
              {...fieldAria('two-factor-code', fieldError)}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              placeholder={useRecovery ? 'abcd-efgh-jkmn-pqrs' : '123456'}
              maxLength={useRecovery ? 24 : 7}
              autoFocus
              disabled={verify.isPending}
            />
          </Field>
          <Button type="submit" className="w-full" loading={verify.isPending}>
            Verify
          </Button>
        </form>
      )}

      {!expired && (
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => {
              setUseRecovery((current) => !current);
              setCode('');
              verify.reset();
            }}
          >
            {useRecovery ? 'Use the authenticator app' : 'Use a recovery code'}
          </button>
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={onRestart}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
