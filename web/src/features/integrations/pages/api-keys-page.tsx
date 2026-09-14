import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { ApiKey } from '@coretask/types';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { ApiKeyTable } from '../components/api-key-table';
import { CreateApiKeyDialog } from '../components/create-api-key-dialog';
import { N8nHelpCard } from '../components/n8n-help-card';
import { RenameApiKeyDialog } from '../components/rename-api-key-dialog';
import { RevokeApiKeyDialog } from '../components/revoke-api-key-dialog';
import { useApiKeys } from '../hooks/use-api-keys';

export function ApiKeysPage() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  // The shell already gates on role; the flag is passed anyway so the query is
  // never started for anyone the API would refuse.
  const { data: apiKeys, isLoading } = useApiKeys(workspaceId, canManage);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  if (!workspace || !canManage) return null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">API keys</h2>
            <p className="text-sm text-muted-foreground">
              Each key acts as its own account in this workspace, so the history says which tool did
              what. Keys can be guests, members or managers — never admins.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <KeyRound className="size-4" aria-hidden="true" />
            Create key
          </Button>
        </div>

        <ApiKeyTable
          apiKeys={apiKeys ?? []}
          isLoading={isLoading}
          onCreate={() => setCreating(true)}
          onEdit={setEditing}
          onRevoke={setRevoking}
        />
      </section>

      <N8nHelpCard workspaceId={workspace.id} />

      <CreateApiKeyDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        actorRole={role}
      />
      <RenameApiKeyDialog
        apiKey={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        workspaceId={workspaceId}
        actorRole={role}
      />
      <RevokeApiKeyDialog
        apiKey={revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        workspaceId={workspaceId}
      />
    </div>
  );
}
