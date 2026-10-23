import { SOCIAL_SSO_PROVIDERS } from '@coretask/contracts';
import { Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';

import { FormError } from '@/components/feedback/form-error';
import { Button } from '@/components/ui/button';

import { ssoApi } from '../api/sso.api';
import { useSsoProviders } from '../hooks/use-sso-providers';
import { SOCIAL_PROVIDER_LABELS, ssoErrorMessage } from '../lib/sso';

import { SocialProviderIcon } from './provider-icons';

/**
 * The other ways in, above the e-mail form on sign-in and sign-up: Google
 * and Microsoft when this server offers them, and a workspace's own SSO.
 *
 * The provider buttons are plain links. The API answers them with a
 * redirect to the provider, and the provider sends the browser back to the
 * API, which sets the session cookie — nothing here is fetched.
 */
export function SsoOptions({
  redirect,
  error,
}: {
  /** The path to land on once signed in. */
  redirect?: string | undefined;
  /** An `?ssoError=` code the API sent the browser back with. */
  error?: string | undefined;
}) {
  const providers = useSsoProviders();
  const offered = SOCIAL_SSO_PROVIDERS.filter((provider) => providers.data?.[provider]);

  return (
    <div className="space-y-3">
      <FormError message={ssoErrorMessage(error)} />

      {offered.map((provider) => (
        <Button key={provider} asChild variant="outline" className="w-full">
          <a href={ssoApi.startUrl(provider, redirect)}>
            <SocialProviderIcon provider={provider} className="size-4" />
            Continue with {SOCIAL_PROVIDER_LABELS[provider]}
          </a>
        </Button>
      ))}

      <Button asChild variant="outline" className="w-full">
        <Link to="/sso" search={redirect ? { redirect } : {}}>
          <KeyRound aria-hidden="true" />
          Sign in with SSO
        </Link>
      </Button>

      <div
        aria-hidden="true"
        className="flex items-center gap-3 py-1 text-xs text-muted-foreground"
      >
        <span className="h-px flex-1 bg-border" />
        or with your e-mail
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
