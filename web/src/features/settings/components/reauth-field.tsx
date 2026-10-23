import type { AuthUser } from '@coretask/types';

import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/features/auth/components/password-input';

/**
 * "Confirm it is you", the field half. Which proof the server will ask for
 * depends on the account, and this shows the same one: the password when
 * there is one, else a code from the authenticator app, else nothing — an
 * account that signs in only with SSO proves it by having signed in recently,
 * and the server says so (`RECENT_SIGN_IN_REQUIRED`) when it has not.
 */
export function ReauthField({
  user,
  value,
  onChange,
  error,
  disabled,
  id = 'reauth',
}: {
  user: Pick<AuthUser, 'hasPassword' | 'twoFactorEnabled'>;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  id?: string;
}) {
  if (user.hasPassword) {
    return (
      <Field label="Your password" htmlFor={id} error={error} required>
        <PasswordInput
          {...fieldAria(id, error)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="current-password"
          disabled={disabled}
        />
      </Field>
    );
  }
  if (user.twoFactorEnabled) {
    return (
      <Field
        label="Code from your authenticator app"
        htmlFor={id}
        error={error}
        hint="Or one of your recovery codes."
        required
      >
        <Input
          {...fieldAria(id, error)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="one-time-code"
          inputMode="numeric"
          disabled={disabled}
        />
      </Field>
    );
  }
  return error ? (
    <p role="alert" className="text-sm font-medium text-destructive">
      {error}
    </p>
  ) : null;
}
