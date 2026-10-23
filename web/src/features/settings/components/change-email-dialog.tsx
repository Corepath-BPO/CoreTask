import type { AuthUser } from '@coretask/types';
import { emailSchema } from '@coretask/validation';
import { useState } from 'react';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/api-error';

import { useRequestEmailChange } from '../hooks/use-account-security';
import { reauthErrorOf, reauthPayload, reauthReady } from '../lib/reauth';

import { ReauthField } from './reauth-field';

/**
 * Moving the account to a new address. The change waits for the link sent to
 * the new inbox, so a typo here costs a resend, not the account.
 */
export function ChangeEmailDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AuthUser;
}) {
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const request = useRequestEmailChange();

  function close(next: boolean) {
    if (!next) {
      setEmail('');
      setSecret('');
      setEmailError(undefined);
      request.reset();
    }
    onOpenChange(next);
  }

  const fieldError = reauthErrorOf(request.error);
  const serverEmailError =
    request.error instanceof ApiError && request.error.code === 'EMAIL_ALREADY_REGISTERED'
      ? 'Another account already uses that address.'
      : undefined;
  const formError =
    request.error && !fieldError && !serverEmailError
      ? request.error instanceof ApiError
        ? request.error.message
        : 'Something went wrong. Please try again.'
      : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change e-mail address</DialogTitle>
          <DialogDescription>
            We send a link to the new address. Your account moves to it once you open the link;
            until then you keep signing in with {user.email}.
          </DialogDescription>
        </DialogHeader>

        <form
          id="change-email"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = emailSchema.safeParse(email);
            if (!parsed.success) {
              setEmailError(parsed.error.issues[0]?.message ?? 'Enter a valid e-mail address.');
              return;
            }
            setEmailError(undefined);
            if (!reauthReady(user, secret)) return;
            request.mutate(
              { email: parsed.data, ...reauthPayload(user, secret) },
              { onSuccess: () => close(false) },
            );
          }}
        >
          <FormError message={formError} />
          <Field
            label="New e-mail address"
            htmlFor="new-email"
            error={emailError ?? serverEmailError}
            required
          >
            <Input
              {...fieldAria('new-email', emailError ?? serverEmailError)}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
              autoFocus
              disabled={request.isPending}
            />
          </Field>
          <ReauthField
            user={user}
            value={secret}
            onChange={setSecret}
            error={fieldError}
            disabled={request.isPending}
          />
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={request.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="change-email"
            loading={request.isPending}
            disabled={!email.trim() || !reauthReady(user, secret)}
          >
            Send link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
