import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Outlet } from '@tanstack/react-router';
import { Plug, ShieldAlert } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import { IntegrationsTabs } from '../components/integrations-tabs';

/**
 * Shell for the integrations area: header, tabs, and the admin gate.
 *
 * The gate is here rather than in each tab so a member who deep-links to a tab
 * never mounts it — and so no admin-only query is ever started for them. The
 * API authorises independently; this is courtesy, not the boundary.
 */
export function IntegrationsPage() {
  const { workspace, isLoading } = useActiveWorkspace();

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading integrations</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <EmptyState
        icon={Plug}
        title="No workspace yet"
        description="Create a workspace before connecting tools to it."
        className="mt-10"
      />
    );
  }

  const role = (workspace.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description={`API keys, webhooks and a playground for the tools that work with ${workspace.name}.`}
      />

      {canManage ? (
        <>
          <div className="border-b border-border">
            <IntegrationsTabs />
          </div>
          <Outlet />
        </>
      ) : (
        <EmptyState
          icon={ShieldAlert}
          title="Workspace admins only"
          description="Ask a workspace admin to manage API keys and webhooks."
        />
      )}
    </div>
  );
}
