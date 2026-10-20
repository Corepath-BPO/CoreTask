import { OAuthAppPolicy, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { DirectoryApp, WorkspaceAppSummary } from '@coretask/types';
import { LayoutGrid } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Field } from '@/components/forms/field';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import {
  useAppDirectory,
  useApproveDirectoryApp,
  useRemoveDirectoryApp,
  useSetAppPolicy,
} from '../hooks/use-oauth';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * Integrations › App directory: the OAuth apps this workspace's admins
 * approved. Every member sees them and whether they use one; admins choose
 * whether only these may act here, and approve apps — by client id, or from
 * the ones members already connected.
 */
export function AppDirectoryPage() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  const { data: directory, isLoading } = useAppDirectory(workspaceId);
  const setPolicy = useSetAppPolicy(workspaceId);
  const approve = useApproveDirectoryApp(workspaceId);
  const remove = useRemoveDirectoryApp(workspaceId);
  const [clientId, setClientId] = useState('');
  const [removing, setRemoving] = useState<DirectoryApp | null>(null);

  const approvedOnly = directory?.policy === OAuthAppPolicy.APPROVED;

  const onApprove = (event: FormEvent) => {
    event.preventDefault();
    const value = clientId.trim();
    if (!value) return;
    approve.mutate({ clientId: value }, { onSuccess: () => setClientId('') });
  };

  return (
    <section className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">App directory</h2>
        <p className="text-sm text-muted-foreground">
          {approvedOnly
            ? `Only these apps can act in ${workspace?.name ?? 'this workspace'}. Any other app a member connects is refused here.`
            : `Apps approved for ${workspace?.name ?? 'this workspace'}. Members may also connect others.`}
        </p>
      </div>

      {isLoading || !directory ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          {canManage && (
            <Card>
              <CardContent className="space-y-4 py-4">
                <fieldset className="space-y-2" disabled={setPolicy.isPending}>
                  <legend className="text-sm font-medium">Which apps can act here</legend>
                  <PolicyOption
                    checked={!approvedOnly}
                    onSelect={() => setPolicy.mutate(OAuthAppPolicy.ANY)}
                    title="Any app members connect"
                    detail="Each person decides which tools act for them."
                  />
                  <PolicyOption
                    checked={approvedOnly}
                    onSelect={() => setPolicy.mutate(OAuthAppPolicy.APPROVED)}
                    title="Only approved apps"
                    detail="Other apps are refused in this workspace and hear none of its webhooks. Nobody is disconnected; they keep working elsewhere."
                  />
                </fieldset>

                <form onSubmit={onApprove} noValidate className="flex flex-wrap items-end gap-2">
                  <Field
                    label="Approve an app by client id"
                    htmlFor="directory-client-id"
                    hint="The developer finds it under Integrations › OAuth apps. It starts with ctc_."
                    className="min-w-60 flex-1"
                  >
                    <Input
                      id="directory-client-id"
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      placeholder="ctc_…"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                    />
                  </Field>
                  <Button type="submit" disabled={approve.isPending || clientId.trim() === ''}>
                    Approve
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {directory.apps.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="No approved apps yet"
              description={
                canManage
                  ? 'Approve an app by its client id, or from the ones members already connected.'
                  : 'Your workspace admins haven’t approved any apps.'
              }
            />
          ) : (
            <ul className="space-y-3" aria-label="Approved apps">
              {directory.apps.map((entry) => (
                <li key={entry.app.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium">
                          <AppName app={entry.app} />
                          {entry.connectedByMe && (
                            <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                              You use this
                            </Badge>
                          )}
                        </p>
                        {entry.app.description && (
                          <p className="text-sm text-muted-foreground">{entry.app.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          By {entry.app.publisher} · approved{' '}
                          {entry.approvedBy ? `by ${entry.approvedBy.name} ` : ''}
                          {dateFormat.format(new Date(entry.approvedAt))}
                        </p>
                      </div>
                      {canManage && (
                        <Button variant="outline" size="sm" onClick={() => setRemoving(entry)}>
                          Remove
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {canManage && directory.unapproved.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Connected, not approved</h3>
                <p className="text-sm text-muted-foreground">
                  {approvedOnly
                    ? 'Members connected these, but they are refused here until you approve them.'
                    : 'Members connected these. Approve one to keep it working if you allow only approved apps.'}
                </p>
              </div>
              <ul className="space-y-3" aria-label="Connected, not approved">
                {directory.unapproved.map((entry) => (
                  <li key={entry.app.id}>
                    <Card>
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium">
                            <AppName app={entry.app} />
                          </p>
                          <p className="text-xs text-muted-foreground">
                            By {entry.app.publisher} ·{' '}
                            {entry.members === 1
                              ? '1 member connected'
                              : `${entry.members} members connected`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ clientId: entry.app.clientId })}
                        >
                          Approve
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.app.name}” from the directory?</AlertDialogTitle>
            <AlertDialogDescription>
              {approvedOnly
                ? 'It stops working in this workspace at once, for everyone who connected it. Nobody is disconnected, and you can approve it again later.'
                : 'Members can still connect it while any app is allowed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() =>
                removing && remove.mutate(removing.app.id, { onSuccess: () => setRemoving(null) })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function AppName({ app }: { app: WorkspaceAppSummary }) {
  return app.websiteUrl ? (
    <a href={app.websiteUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">
      {app.name}
    </a>
  ) : (
    <>{app.name}</>
  );
}

function PolicyOption({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="radio"
        name="app-policy"
        checked={checked}
        onChange={() => !checked && onSelect()}
        className="mt-0.5 accent-primary"
      />
      <span>
        <span className="font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
