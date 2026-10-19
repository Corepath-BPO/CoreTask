import { ApiRoutes, API_PREFIX, OAUTH_AUTHORIZE_PATH } from '@coretask/contracts';
import type { OAuthApp } from '@coretask/types';
import { AppWindow, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { env } from '@/app/config/env';

import { CopyField } from '../components/copy-field';
import { OAuthAppDialog } from '../components/oauth-app-dialog';
import { SecretRevealDialog } from '../components/secret-reveal-dialog';
import { useDeleteOAuthApp, useOAuthApps, useRotateOAuthSecret } from '../hooks/use-oauth';

/**
 * Integrations › OAuth apps: the apps this person registered as a developer.
 *
 * Anyone may register one — it is their own, and acts only for the people who
 * choose to connect it — so this tab is open to members as well as admins.
 */
export function OAuthAppsPage() {
  const { data: apps, isLoading } = useOAuthApps();
  const rotate = useRotateOAuthSecret();
  const remove = useDeleteOAuthApp();

  const [editing, setEditing] = useState<OAuthApp | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OAuthApp | null>(null);

  const openForm = (app: OAuthApp | null) => {
    setEditing(app);
    setFormOpen(true);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">OAuth apps</h2>
            <p className="text-sm text-muted-foreground">
              Apps you built that act for the people who connect them, in every workspace they
              belong to. Nobody is connected until they allow it themselves.
            </p>
          </div>
          <Button onClick={() => openForm(null)}>
            <Plus className="size-4" aria-hidden="true" />
            Register app
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (apps ?? []).length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="No apps yet"
            description="Register an app to let a tool you build connect to CoreTask on someone’s behalf."
            action={
              <Button variant="outline" onClick={() => openForm(null)}>
                Register app
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3" aria-label="Your OAuth apps">
            {(apps ?? []).map((app) => (
              <li key={app.id}>
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {app.name}
                        <Badge variant="muted" className="text-[10px]">
                          {app.connections === 1
                            ? '1 person connected'
                            : `${app.connections} people connected`}
                        </Badge>
                      </CardTitle>
                      {app.description && <CardDescription>{app.description}</CardDescription>}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${app.name}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openForm(app)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            rotate.mutate(app.id, {
                              onSuccess: (result) => setSecret(result.clientSecret),
                            })
                          }
                        >
                          Replace secret
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleting(app)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <CopyField label="Client id" value={app.clientId} id={`client-id-${app.id}`} />
                    <p className="text-muted-foreground">
                      Secret <span className="font-mono text-xs">{app.secretHint}…</span>
                    </p>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Redirect URIs</p>
                      <ul className="space-y-0.5 font-mono text-xs">
                        {app.redirectUris.map((uri) => (
                          <li key={uri} className="break-all">
                            {uri}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConnectHelpCard />

      <OAuthAppDialog open={formOpen} onOpenChange={setFormOpen} app={editing} />
      <SecretRevealDialog
        secret={secret}
        onOpenChange={(open) => !open && setSecret(null)}
        title="New client secret"
        description="The old secret stopped working. People who connected the app stay connected."
        label="Client secret"
      />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone who connected it is disconnected and the webhooks it subscribed are deleted.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() =>
                deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The three addresses a developer needs, with the flow in a sentence each. */
function ConnectHelpCard() {
  const authorizeUrl = `${window.location.origin}${OAUTH_AUTHORIZE_PATH}`;
  const tokenUrl = `${env.apiUrl}${ApiRoutes.oauth.token}`;

  return (
    <Card className="h-fit bg-muted/25">
      <CardHeader>
        <CardTitle className="text-base">Connecting a tool</CardTitle>
        <CardDescription>The authorization-code flow, as Asana’s works.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="list-decimal space-y-2 pl-4 text-muted-foreground">
          <li>
            Send the person to the authorize URL with <code>client_id</code>,{' '}
            <code>redirect_uri</code>, <code>response_type=code</code> and a <code>state</code>.
            PKCE (<code>code_challenge</code>, S256) is welcome.
          </li>
          <li>
            They allow it, and come back to your redirect URI with <code>code</code> and your{' '}
            <code>state</code>.
          </li>
          <li>
            Post the code to the token URL with your client id and secret. You get an access token
            for an hour and a refresh token; call the API with{' '}
            <code>Authorization: Bearer cto_…</code>.
          </li>
          <li>
            Subscribe webhooks with{' '}
            <code>POST {API_PREFIX}/workspaces/…/webhook-subscriptions</code>.
          </li>
        </ol>
        <CopyField label="Authorize URL" value={authorizeUrl} id="oauth-authorize-url" />
        <CopyField label="Token URL" value={tokenUrl} id="oauth-token-url" />
      </CardContent>
    </Card>
  );
}
