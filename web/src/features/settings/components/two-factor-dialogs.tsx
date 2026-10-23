import type { AuthUser } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { Copy, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
import { authApi } from '@/features/auth/api/auth.api';
import { ApiError } from '@/lib/api/api-error';

import { setTwoFactorEnabled } from '../hooks/use-account-security';
import { reauthErrorOf, reauthPayload, reauthReady } from '../lib/reauth';

import { ReauthField } from './reauth-field';

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function errorText(error: unknown): string | null {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

/**
 * Turning two-step verification on: scan the code, type the first number it
 * makes, then keep the recovery codes. Nothing is saved until the number
 * checks out, so closing half-way leaves the account as it was.
 */
export function TwoFactorSetupDialog({ open, onOpenChange }: DialogProps) {
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const started = useRef(false);

  const setup = useMutation({ mutationFn: () => authApi.setupTwoFactor() });
  const enable = useMutation({
    mutationFn: () =>
      authApi.enableTwoFactor({ setupToken: setup.data?.setupToken ?? '', code: code.trim() }),
    onSuccess: (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setTwoFactorEnabled(true);
    },
  });

  // One secret per opening: StrictMode's second effect must not mint another
  // and leave the QR code and the setup token disagreeing.
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setup.mutate();
  }, [open, setup]);

  function close(next: boolean) {
    if (!next) {
      started.current = false;
      setCode('');
      setRecoveryCodes(null);
      setup.reset();
      enable.reset();
      if (recoveryCodes) toast.success('Two-step verification is on.');
    }
    onOpenChange(next);
  }

  const codeError =
    enable.error instanceof ApiError && enable.error.code === 'TWO_FACTOR_CODE_INVALID'
      ? enable.error.message
      : undefined;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {recoveryCodes ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                If you lose your phone, each of these gets you in once. They are shown only now —
                keep them somewhere safe, such as a password manager.
              </DialogDescription>
            </DialogHeader>
            <RecoveryCodesList codes={recoveryCodes} />
            <DialogFooter>
              <Button onClick={() => close(false)}>I have saved them</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Turn on two-step verification</DialogTitle>
              <DialogDescription>
                Scan this with an authenticator app — Google Authenticator, Microsoft Authenticator,
                1Password and the like — then type the code it shows.
              </DialogDescription>
            </DialogHeader>

            <FormError message={setup.isError ? errorText(setup.error) : null} />

            {setup.data ? (
              <form
                id="two-factor-setup"
                noValidate
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (code.trim()) enable.mutate();
                }}
              >
                <div className="flex justify-center rounded-lg border bg-white p-3">
                  <img
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.data.qrSvg)}`}
                    alt="QR code for your authenticator app"
                    className="size-44"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Cannot scan it? Enter this key instead:{' '}
                  <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                    {setup.data.secret.match(/.{1,4}/g)?.join(' ')}
                  </code>
                </p>
                <FormError message={enable.error && !codeError ? errorText(enable.error) : null} />
                <Field
                  label="Code from the app"
                  htmlFor="two-factor-setup-code"
                  error={codeError}
                  required
                >
                  <Input
                    {...fieldAria('two-factor-setup-code', codeError)}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    placeholder="123456"
                    maxLength={7}
                    autoFocus
                    disabled={enable.isPending}
                  />
                </Field>
              </form>
            ) : (
              !setup.isError && (
                <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                  Making your code…
                </div>
              )
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)} disabled={enable.isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="two-factor-setup"
                loading={enable.isPending}
                disabled={!setup.data || !code.trim()}
              >
                Turn on
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Turning it off, after "confirm it is you". */
export function TwoFactorDisableDialog({
  open,
  onOpenChange,
  user,
}: DialogProps & { user: AuthUser }) {
  const [value, setValue] = useState('');
  const disable = useMutation({
    mutationFn: () => authApi.disableTwoFactor(reauthPayload(user, value)),
    onSuccess: () => {
      setTwoFactorEnabled(false);
      toast.success('Two-step verification is off.');
      close(false);
    },
  });

  function close(next: boolean) {
    if (!next) {
      setValue('');
      disable.reset();
    }
    onOpenChange(next);
  }

  const fieldError = reauthErrorOf(disable.error);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Turn off two-step verification?</DialogTitle>
          <DialogDescription>
            Signing in will take only your password again, and your recovery codes stop working.
          </DialogDescription>
        </DialogHeader>
        <form
          id="two-factor-disable"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reauthReady(user, value)) disable.mutate();
          }}
        >
          <FormError message={disable.error && !fieldError ? errorText(disable.error) : null} />
          <ReauthField
            user={user}
            value={value}
            onChange={setValue}
            error={fieldError}
            disabled={disable.isPending}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={disable.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="two-factor-disable"
            variant="destructive"
            loading={disable.isPending}
            disabled={!reauthReady(user, value)}
          >
            Turn off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A new set of recovery codes; the old set stops working. */
export function RecoveryCodesDialog({
  open,
  onOpenChange,
  user,
}: DialogProps & { user: AuthUser }) {
  const [value, setValue] = useState('');
  const regenerate = useMutation({
    mutationFn: () => authApi.regenerateRecoveryCodes(reauthPayload(user, value)),
    onSuccess: () => setTwoFactorEnabled(true),
  });

  function close(next: boolean) {
    if (!next) {
      setValue('');
      regenerate.reset();
    }
    onOpenChange(next);
  }

  const fieldError = reauthErrorOf(regenerate.error);
  const codes = regenerate.data?.recoveryCodes;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {codes ? 'Your new recovery codes' : 'Make new recovery codes?'}
          </DialogTitle>
          <DialogDescription>
            {codes
              ? 'Your old codes no longer work. These are shown only now — keep them somewhere safe.'
              : 'Your current codes stop working as soon as the new ones are made.'}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodesList codes={codes} />
        ) : (
          <form
            id="recovery-codes"
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reauthReady(user, value)) regenerate.mutate();
            }}
          >
            <FormError
              message={regenerate.error && !fieldError ? errorText(regenerate.error) : null}
            />
            <ReauthField
              user={user}
              value={value}
              onChange={setValue}
              error={fieldError}
              disabled={regenerate.isPending}
            />
          </form>
        )}
        <DialogFooter>
          {codes ? (
            <Button onClick={() => close(false)}>I have saved them</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => close(false)}
                disabled={regenerate.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="recovery-codes"
                loading={regenerate.isPending}
                disabled={!reauthReady(user, value)}
              >
                Make new codes
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecoveryCodesList({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-3">
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast.success('Copied.'),
              () => toast.error('Could not copy. Select the codes and copy them instead.'),
            )
          }
        >
          <Copy />
          Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'coretask-recovery-codes.txt';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download />
          Download
        </Button>
      </div>
    </div>
  );
}
