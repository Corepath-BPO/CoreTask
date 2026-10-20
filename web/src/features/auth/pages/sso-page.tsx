import { Link, useSearch } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ssoApi } from '../api/sso.api';
import { leaveFor } from '../lib/leave-for';
import { ssoErrorMessage, workspaceTarget } from '../lib/sso';

const HINT = 'Your work address, or your workspace’s name in its CoreTask link: acme in /w/acme.';

/**
 * "Sign in with SSO", for workspaces that sign their people in through their
 * own identity provider. The API finds the workspace and sends the browser
 * on; when it cannot, it sends it back here with `?error=`.
 */
export function SsoPage() {
  const search: Partial<{ error: string; redirect: string }> = useSearch({ strict: false });
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [leaving, setLeaving] = useState(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = workspaceTarget(value);
    if (!target) {
      setFieldError('Enter your work e-mail address, or your workspace’s name.');
      return;
    }
    setFieldError(undefined);
    setLeaving(true);
    leaveFor(ssoApi.samlStartUrl(target, search.redirect));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <KeyRound className="size-5 text-primary-strong" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in with SSO</h1>
        <p className="text-sm text-muted-foreground">
          For workspaces that sign people in through their own identity provider, such as Okta or
          Microsoft Entra ID.
        </p>
      </div>

      <FormError message={ssoErrorMessage(search.error)} />

      <form noValidate className="space-y-4" onSubmit={onSubmit}>
        <Field
          label="Work e-mail or workspace"
          htmlFor="sso-target"
          error={fieldError}
          hint={HINT}
          required
        >
          <Input
            {...fieldAria('sso-target', fieldError, HINT)}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus
            disabled={leaving}
          />
        </Field>
        <Button type="submit" className="w-full" loading={leaving}>
          Continue
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          to="/login"
          search={search.redirect ? { redirect: search.redirect } : {}}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in another way
        </Link>
      </p>
    </div>
  );
}
