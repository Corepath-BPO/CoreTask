import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link, Navigate, Outlet, useLocation } from '@tanstack/react-router';
import { Construction, ShieldAlert, ShieldCheck } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';

import { ADMIN_TABS } from '../lib/admin-tabs';

/**
 * Shell for the admin console: header, tabs, and the super admin gate.
 *
 * The gate is here rather than in each tab, so someone below super admin who
 * deep-links to a tab never mounts it and never starts a query that would be
 * refused. The API authorises independently; this is courtesy, not the boundary.
 */
export function AdminConsolePage() {
  const { workspace, isLoading } = useActiveWorkspace();

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading the admin console</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No workspace yet"
        description="Create a workspace before running it from here."
        className="mt-10"
      />
    );
  }

  const role = (workspace.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  if (!hasAtLeastRole(role, WorkspaceRole.SUPER_ADMIN)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Super admins only"
        description={`The admin console runs ${workspace.name} as a whole. Ask its owner or a super admin if you need something changed.`}
        className="mt-10"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin console"
        description={`People, teams and the health of ${workspace.name}, for its super admins.`}
      />
      <div className="border-b border-border">
        <AdminTabs />
      </div>
      <Outlet />
    </div>
  );
}

/** Links rather than local state, so the tab lives in the URL and survives a refresh. */
function AdminTabs() {
  const { pathname } = useLocation();

  return (
    <div
      role="tablist"
      aria-label="Admin console"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-px"
    >
      {ADMIN_TABS.map((tab) => {
        const to = `/admin/${tab.segment}`;
        const isActive = pathname === to || pathname.startsWith(`${to}/`);

        return (
          <Link
            key={tab.segment}
            to={to}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              isActive
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.comingSoon && (
              <Badge variant="muted" className="ml-0.5 text-[10px]">
                Soon
              </Badge>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** Bare `/admin` opens the overview. */
export function AdminIndex() {
  return <Navigate to="/admin/overview" replace />;
}

/** What each unbuilt tab will hold, and where its nearest working part lives today. */
const COMING: Record<string, { description: string; link?: { to: string; label: string } }> = {
  security: {
    description:
      'Require SSO or two-step verification, limit session length and choose which e-mail domains may be invited. SAML and verified domains are set up in Settings today.',
    link: { to: '/settings', label: 'Open Settings' },
  },
  apps: {
    description:
      'Every integration in one place, with its health: API keys, webhooks, OAuth apps, Slack and the Asana sync. Each has its own tab under Integrations today.',
    link: { to: '/integrations', label: 'Open Integrations' },
  },
  insights: {
    description: 'Active people, work created and finished each week, storage and automation runs.',
  },
  'audit-log': {
    description:
      'Every administrative change and sign-in, filterable by person, kind and date, with a CSV export. Changes are already being recorded.',
  },
  export: {
    description: 'A download of the whole workspace as JSON and CSV files.',
  },
  settings: {
    description:
      'The workspace name, logo, domains and ticket prefix. They are edited in Settings today.',
    link: { to: '/settings', label: 'Open Settings' },
  },
};

export function AdminComingSoon({ segment }: { segment: string }) {
  const tab = ADMIN_TABS.find((entry) => entry.segment === segment);
  const coming = COMING[segment];

  return (
    <EmptyState
      icon={Construction}
      title={`${tab?.label ?? 'This'} is coming next`}
      description={coming?.description ?? ''}
      action={
        coming?.link ? (
          <Button variant="outline" asChild>
            <Link to={coming.link.to}>{coming.link.label}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
