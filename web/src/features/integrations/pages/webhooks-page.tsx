import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { WebhookEndpoint } from '@coretask/types';
import { Webhook } from 'lucide-react';
import { useState } from 'react';

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
import { Button } from '@/components/ui/button';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { SecretRevealDialog } from '../components/secret-reveal-dialog';
import { WebhookDeliveriesDialog } from '../components/webhook-deliveries-dialog';
import { WebhookFormDialog } from '../components/webhook-form-dialog';
import { WebhookTable } from '../components/webhook-table';
import {
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useWebhooks,
} from '../hooks/use-webhooks';

export function WebhooksPage() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  const { data: webhooks, isLoading } = useWebhooks(workspaceId, canManage);
  const test = useTestWebhook(workspaceId);
  const rotate = useRotateWebhookSecret(workspaceId);
  const remove = useDeleteWebhook(workspaceId);

  // `'create'` opens the form empty; an endpoint opens it prefilled.
  const [formTarget, setFormTarget] = useState<'create' | WebhookEndpoint | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpoint | null>(null);
  const [pendingRotate, setPendingRotate] = useState<WebhookEndpoint | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookEndpoint | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  if (!workspace || !canManage) return null;

  const confirmRotate = () => {
    if (!pendingRotate) return;
    rotate.mutate(pendingRotate.id, {
      onSuccess: (result) => {
        setPendingRotate(null);
        setRotatedSecret(result.secret);
      },
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            CoreTask calls these URLs when tasks, comments or tickets change. Each delivery is
            signed, retried on failure, and listed here with its outcome.
          </p>
        </div>
        <Button onClick={() => setFormTarget('create')}>
          <Webhook className="size-4" aria-hidden="true" />
          Add endpoint
        </Button>
      </div>

      <WebhookTable
        workspaceId={workspaceId}
        webhooks={webhooks ?? []}
        isLoading={isLoading}
        onCreate={() => setFormTarget('create')}
        onEdit={setFormTarget}
        onDeliveries={setDeliveriesFor}
        onTest={(webhook) => test.mutate(webhook.id)}
        onRotate={setPendingRotate}
        onDelete={setPendingDelete}
      />

      <WebhookFormDialog
        open={formTarget !== null}
        onOpenChange={(open) => !open && setFormTarget(null)}
        workspaceId={workspaceId}
        webhook={formTarget === 'create' ? null : formTarget}
      />

      <WebhookDeliveriesDialog
        workspaceId={workspaceId}
        webhook={deliveriesFor}
        onOpenChange={(open) => !open && setDeliveriesFor(null)}
      />

      <SecretRevealDialog
        secret={rotatedSecret}
        onOpenChange={(open) => !open && setRotatedSecret(null)}
        title="New signing secret"
        description="Deliveries are signed with this secret from now on. Update the receiver before they resume."
        label="Signing secret"
      />

      <AlertDialog
        open={pendingRotate !== null}
        onOpenChange={(open) => !open && setPendingRotate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the secret for “{pendingRotate?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret stops verifying immediately. Deliveries keep going out, so update
              the receiver with the new secret straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotate.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRotate} disabled={rotate.isPending}>
              Rotate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Deliveries stop immediately and the endpoint’s history goes with it. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
