import { ACCOUNT_DELETION_CONFIRMATION } from '@coretask/contracts';
import type { AccountDeletionPreview, AuthUser } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { UserX } from 'lucide-react';
import { useState } from 'react';

import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/api-error';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { useAccountDeletionPreview, useDeleteAccount } from '../hooks/use-account-deletion';
import { reauthErrorOf, reauthPayload, reauthReady } from '../lib/reauth';

import { ReauthField } from './reauth-field';

/** The last card in settings: leaving CoreTask altogether. */
export function DeleteAccountCard({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Removes your profile and sign-in, and the workspaces only you are in. What you wrote in
          shared workspaces stays, under “Deleted user”.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <UserX />
          Delete account
        </Button>
      </CardContent>
      {open && <DeleteAccountDialog onOpenChange={setOpen} user={user} />}
    </Card>
  );
}

/**
 * Mounted only while open, so the preview is asked for fresh each time: what
 * would be deleted depends on who is in which workspace right now.
 */
function DeleteAccountDialog({
  onOpenChange,
  user,
}: {
  onOpenChange: (open: boolean) => void;
  user: AuthUser;
}) {
  const [typed, setTyped] = useState('');
  const [secret, setSecret] = useState('');
  const preview = useAccountDeletionPreview(true);
  const remove = useDeleteAccount();

  const blocked = (preview.data?.workspacesBlocking.length ?? 0) > 0;
  const confirmError =
    remove.error instanceof ApiError && remove.error.code === 'CONFIRMATION_MISMATCH'
      ? `Type ${ACCOUNT_DELETION_CONFIRMATION}, in capitals.`
      : undefined;
  const secretError = reauthErrorOf(remove.error);
  const formError =
    remove.error && !confirmError && !secretError
      ? remove.error instanceof ApiError
        ? remove.error.message
        : 'Something went wrong. Please try again.'
      : preview.error
        ? 'Could not check your workspaces. Close this and try again.'
        : null;
  const ready =
    preview.isSuccess &&
    !blocked &&
    typed === ACCOUNT_DELETION_CONFIRMATION &&
    reauthReady(user, secret);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            You are signed out everywhere and {user.email} stops working for CoreTask. This cannot
            be undone.
          </DialogDescription>
        </DialogHeader>

        <form
          id="delete-account"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            // The hook signs this browser out and goes to the sign-in page.
            remove.mutate({ confirmation: typed, ...reauthPayload(user, secret) });
          }}
        >
          <FormError message={formError} />
          {preview.isPending ? (
            <div className="space-y-2" aria-label="Checking your workspaces">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : preview.data ? (
            <Consequences preview={preview.data} onLeave={() => onOpenChange(false)} />
          ) : null}

          {!blocked && (
            <>
              <Field
                label={`Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm`}
                htmlFor="delete-account-confirmation"
                error={confirmError}
                required
              >
                <Input
                  {...fieldAria('delete-account-confirmation', confirmError)}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={remove.isPending}
                />
              </Field>
              <ReauthField
                id="delete-account-reauth"
                user={user}
                value={secret}
                onChange={setSecret}
                error={secretError}
                disabled={remove.isPending}
              />
            </>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="delete-account"
            variant="destructive"
            loading={remove.isPending}
            disabled={!ready || remove.isPending}
          >
            Delete my account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What goes, what is left, and what has to be dealt with first. */
function Consequences({
  preview,
  onLeave,
}: {
  preview: AccountDeletionPreview;
  onLeave: () => void;
}) {
  const select = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  if (preview.workspacesBlocking.length > 0) {
    return (
      <section
        aria-label="Workspaces to deal with first"
        className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
      >
        <p className="font-medium">
          You own workspaces other people use. Make someone else the owner, or delete the workspace,
          first:
        </p>
        <ul className="space-y-1">
          {preview.workspacesBlocking.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {workspace.name}{' '}
                <span className="text-muted-foreground">
                  ({workspace.memberCount} {workspace.memberCount === 1 ? 'member' : 'members'})
                </span>
              </span>
              <Link
                to="/members"
                className="text-xs font-semibold text-primary-strong underline-offset-4 hover:underline"
                onClick={() => {
                  select(workspace.id);
                  onLeave();
                }}
              >
                Manage members
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {preview.workspacesDeleted.length > 0 && (
        <section aria-label="Deleted with your account" className="space-y-1">
          <p className="font-medium">Deleted with your account, since only you are in them:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {preview.workspacesDeleted.map((workspace) => (
              <li key={workspace.id}>{workspace.name}</li>
            ))}
          </ul>
        </section>
      )}
      {preview.workspacesLeft.length > 0 && (
        <section aria-label="Workspaces you leave" className="space-y-1">
          <p className="font-medium">You leave these; open work assigned to you is unassigned:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {preview.workspacesLeft.map((workspace) => (
              <li key={workspace.id}>{workspace.name}</li>
            ))}
          </ul>
        </section>
      )}
      {preview.workspacesDeleted.length === 0 && preview.workspacesLeft.length === 0 && (
        <p className="text-muted-foreground">You are not in any workspace.</p>
      )}
    </div>
  );
}
