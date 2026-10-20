import type { AuthUser, WorkspaceSummary } from '@coretask/types';
import { Trash2 } from 'lucide-react';
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
import { ApiError } from '@/lib/api/api-error';

import { useDeleteWorkspace } from '../hooks/use-account-deletion';
import { reauthErrorOf, reauthPayload, reauthReady } from '../lib/reauth';

import { ReauthField } from './reauth-field';

/**
 * The owner's way to delete the workspace, at the bottom of its settings.
 * Nothing in it survives, for anyone, so the name is typed back first.
 */
export function DeleteWorkspaceCard({
  workspace,
  user,
}: {
  workspace: WorkspaceSummary;
  user: AuthUser;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>
          Deleting this workspace deletes every project, task, comment and file in it, for everyone
          in it. It cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-1">
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete workspace
        </Button>
      </CardContent>
      <DeleteWorkspaceDialog open={open} onOpenChange={setOpen} workspace={workspace} user={user} />
    </Card>
  );
}

function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceSummary;
  user: AuthUser;
}) {
  const [typed, setTyped] = useState('');
  const [secret, setSecret] = useState('');
  const remove = useDeleteWorkspace(workspace);

  function close(next: boolean) {
    if (!next) {
      setTyped('');
      setSecret('');
      remove.reset();
    }
    onOpenChange(next);
  }

  const nameError =
    remove.error instanceof ApiError && remove.error.code === 'CONFIRMATION_MISMATCH'
      ? 'That is not the workspace’s name. Type it exactly as shown.'
      : undefined;
  const secretError = reauthErrorOf(remove.error);
  const formError =
    remove.error && !nameError && !secretError
      ? remove.error instanceof ApiError
        ? remove.error.message
        : 'Something went wrong. Please try again.'
      : null;
  const matches = typed === workspace.name;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {workspace.name}?</DialogTitle>
          <DialogDescription>
            Every project, task, ticket, comment, file, API key and webhook in it is deleted
            {workspace.memberCount > 1 ? `, for all ${workspace.memberCount} members` : ''}. Nobody
            can get any of it back.
          </DialogDescription>
        </DialogHeader>

        <form
          id="delete-workspace"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches || !reauthReady(user, secret)) return;
            // The hook toasts and moves on; this only closes, if still here.
            remove.mutate(
              { confirmation: typed, ...reauthPayload(user, secret) },
              { onSuccess: () => close(false) },
            );
          }}
        >
          <FormError message={formError} />
          <Field
            label={`Type ${workspace.name} to confirm`}
            htmlFor="delete-workspace-name"
            error={nameError}
            required
          >
            <Input
              {...fieldAria('delete-workspace-name', nameError)}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={remove.isPending}
            />
          </Field>
          <ReauthField
            id="delete-workspace-reauth"
            user={user}
            value={secret}
            onChange={setSecret}
            error={secretError}
            disabled={remove.isPending}
          />
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="delete-workspace"
            variant="destructive"
            loading={remove.isPending}
            disabled={!matches || !reauthReady(user, secret) || remove.isPending}
          >
            Delete workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
