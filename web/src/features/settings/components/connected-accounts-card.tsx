import { SOCIAL_SSO_PROVIDERS, type SocialSsoProvider } from '@coretask/contracts';
import type { AuthUser, LinkedIdentity } from '@coretask/types';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SocialProviderIcon } from '@/features/auth/components/provider-icons';
import { useSsoProviders } from '@/features/auth/hooks/use-sso-providers';
import { SOCIAL_PROVIDER_LABELS, ssoErrorMessage } from '@/features/auth/lib/sso';
import { formatDate } from '@/lib/utils/format';

import {
  useConnectProvider,
  useDisconnectIdentity,
  useLinkedIdentities,
} from '../hooks/use-sso-settings';

const PROVIDER_ENUM: Record<SocialSsoProvider, LinkedIdentity['provider']> = {
  google: 'GOOGLE',
  microsoft: 'MICROSOFT',
};
const LINKED_NAMES: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  saml: 'Single sign-on',
};

/**
 * Settings › Connected accounts: Google, Microsoft and the workspaces' own
 * identity providers this account can sign in with, besides its password.
 *
 * Connecting leaves for the provider and comes back here with
 * `?ssoLinked=<provider>` or `?ssoError=<code>`, said once as a toast and
 * then taken off the address.
 */
export function ConnectedAccountsCard({ user }: { user: AuthUser }) {
  const providers = useSsoProviders();
  const identities = useLinkedIdentities();
  const connect = useConnectProvider();
  const disconnect = useDisconnectIdentity();
  useReturnFromProvider();

  const linked = identities.data ?? [];
  const social = SOCIAL_SSO_PROVIDERS.filter(
    (provider) =>
      providers.data?.[provider] ||
      linked.some((identity) => identity.provider === PROVIDER_ENUM[provider]),
  );
  const saml = linked.filter((identity) => identity.provider === 'SAML');
  // The server refuses it too; saying so here saves the round trip.
  const onlyWayIn = !user.hasPassword && linked.length === 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>
          {user.hasPassword
            ? 'Ways to sign in besides your password.'
            : 'The ways you sign in: your account has no password.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        {identities.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <>
            {social.map((provider) => {
              const identity = linked.find((item) => item.provider === PROVIDER_ENUM[provider]);
              const label = SOCIAL_PROVIDER_LABELS[provider];
              return (
                <Row
                  key={provider}
                  icon={<SocialProviderIcon provider={provider} className="size-5" />}
                  title={label}
                  detail={identity ? identity.email : 'Not connected'}
                  action={
                    identity ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Disconnect ${label}`}
                        disabled={onlyWayIn}
                        loading={disconnect.isPending && disconnect.variables === identity.id}
                        onClick={() => disconnect.mutate(identity.id)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Connect ${label}`}
                        disabled={!providers.data?.[provider]}
                        loading={connect.isPending && connect.variables === provider}
                        onClick={() => connect.mutate(provider)}
                      >
                        Connect
                      </Button>
                    )
                  }
                />
              );
            })}

            {saml.map((identity) => {
              const label = identity.workspace
                ? `${identity.workspace.name} single sign-on`
                : 'Single sign-on';
              return (
                <Row
                  key={identity.id}
                  icon={<KeyRound className="size-5 text-muted-foreground" aria-hidden="true" />}
                  title={label}
                  detail={
                    identity.lastUsedAt
                      ? `${identity.email} · last used ${formatDate(identity.lastUsedAt)}`
                      : identity.email
                  }
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Disconnect ${label}`}
                      disabled={onlyWayIn}
                      loading={disconnect.isPending && disconnect.variables === identity.id}
                      onClick={() => disconnect.mutate(identity.id)}
                    >
                      Disconnect
                    </Button>
                  }
                />
              );
            })}

            {social.length === 0 && saml.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing is connected. A workspace’s single sign-on shows here once you have signed
                in with it.
              </p>
            )}

            {onlyWayIn && (
              <p className="text-xs text-muted-foreground">
                This is the only way you can sign in. Set a password before disconnecting it.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
  );
}

/** Says how a round trip to a provider went, once, and tidies the address. */
function useReturnFromProvider() {
  const search: Partial<{ ssoLinked: string; ssoError: string }> = useSearch({ strict: false });
  const navigate = useNavigate();
  const said = useRef(false);
  const { ssoLinked, ssoError } = search;

  useEffect(() => {
    if (said.current || (!ssoLinked && !ssoError)) return;
    said.current = true;
    if (ssoLinked) {
      toast.success(`${LINKED_NAMES[ssoLinked] ?? 'The account'} is connected.`);
    } else {
      toast.error(ssoErrorMessage(ssoError));
    }
    void navigate({ to: '.', search: {}, replace: true });
  }, [ssoLinked, ssoError, navigate]);
}
