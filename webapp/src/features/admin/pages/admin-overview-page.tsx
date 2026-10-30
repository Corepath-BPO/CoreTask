import { WORKSPACE_ROLES } from '@coretask/contracts';
import type { AdminOverview } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';

import { StatCard } from '@/components/data-display/stat-card';
import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/features/attachments/lib/format-bytes';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatDate, formatRelativeTime, humanizeEnum } from '@/lib/utils';

import { useAdminOverview } from '../hooks/use-admin';

const count = new Intl.NumberFormat();

/** The console's front page: the workspace in numbers, then what needs a look. */
export function AdminOverviewPage() {
  const { workspace } = useActiveWorkspace();
  const { data: overview, isLoading, isError } = useAdminOverview(workspace?.id);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <span className="sr-only">Loading the overview</span>
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !overview) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="The overview did not load"
        description="Refresh the page to try again."
      />
    );
  }

  const { people } = overview;

  return (
    <div className="space-y-6">
      <section aria-label="Workspace in numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="People"
          value={count.format(people.total - people.deactivated)}
          hint={peopleHint(overview)}
          featured
        />
        <StatCard
          label="Active in the last 7 days"
          value={count.format(people.activeLast7Days)}
          hint={`${count.format(people.activeLast30Days)} in the last 30 days`}
        />
        <StatCard
          label="Open tasks"
          value={count.format(overview.tasks.open)}
          hint={`${count.format(overview.tasks.createdLast30Days)} created and ${count.format(overview.tasks.completedLast30Days)} completed in 30 days`}
        />
        <StatCard
          label="Projects"
          value={count.format(overview.projects.active)}
          hint={`${count.format(overview.projects.archived)} archived · ${count.format(overview.teams)} teams`}
        />
        <StatCard
          label="Pending invitations"
          value={count.format(overview.invitations.pending)}
          hint={
            overview.invitations.expired > 0
              ? `${count.format(overview.invitations.expired)} expired, waiting to be sent again`
              : 'None expired'
          }
        />
        <StatCard
          label="Two-step verification"
          value={`${count.format(people.twoFactorEnabled)} of ${count.format(people.active + people.notSignedUp)}`}
          hint="People with an authenticator app set up"
        />
        <StatCard
          label="Storage"
          value={formatBytes(overview.storage.bytes)}
          hint={`${count.format(overview.storage.files)} files`}
        />
        <StatCard
          label="Automation runs, 7 days"
          value={count.format(overview.automations.runsLast7Days)}
          hint={`${count.format(overview.automations.failedLast7Days)} failed · ${count.format(overview.automations.active)} active rules`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>People by role</CardTitle>
            <CardDescription>Every membership, deactivated ones included.</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            <dl className="divide-y text-sm">
              {WORKSPACE_ROLES.map((role) => (
                <div key={role} className="flex items-center justify-between py-2">
                  <dt>{humanizeEnum(role)}</dt>
                  <dd className="tabular-nums text-muted-foreground">
                    {count.format(people.byRole[role] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign-in</CardTitle>
            <CardDescription>How people get into this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1 text-sm">
            <Row label="SAML single sign-on">
              {overview.sso.enabled ? (
                <Badge variant="success">On</Badge>
              ) : overview.sso.configured ? (
                <Badge variant="warning">Set up, not on</Badge>
              ) : (
                <Badge variant="muted">Not set up</Badge>
              )}
            </Row>
            <Row label="Verified domains">
              <span className="text-right text-muted-foreground">
                {overview.sso.verifiedDomains.length > 0
                  ? overview.sso.verifiedDomains.join(', ')
                  : 'None'}
              </span>
            </Row>
            <Row label="Owner">
              <span className="truncate text-muted-foreground">
                {overview.workspace.owner?.name ?? 'Nobody'}
              </span>
            </Row>
            <Row label="Created">
              <span className="text-muted-foreground">
                {formatDate(overview.workspace.createdAt)}
              </span>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asana</CardTitle>
            <CardDescription>The import and the sync that keeps it current.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1 text-sm">
            {overview.asana ? (
              <>
                <Row label="Live sync">
                  <Badge variant={overview.asana.liveSync ? 'success' : 'muted'}>
                    {overview.asana.liveSync ? 'On' : 'Off'}
                  </Badge>
                </Row>
                <Row label="Last run">
                  {overview.asana.lastRun ? (
                    <span className="text-right text-muted-foreground">
                      {humanizeEnum(overview.asana.lastRun.status)}
                      {overview.asana.lastRun.finishedAt &&
                        ` · ${formatRelativeTime(overview.asana.lastRun.finishedAt)}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None yet</span>
                  )}
                </Row>
                <Link
                  to="/integrations/asana"
                  className="inline-block text-sm font-medium text-primary hover:underline"
                >
                  Open the Asana tab
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">
                Nothing imported from Asana into this workspace.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function peopleHint(overview: AdminOverview): string {
  const { people } = overview;
  const parts = [
    `${count.format(people.active)} signed up`,
    people.notSignedUp > 0 ? `${count.format(people.notSignedUp)} not yet` : null,
    people.deactivated > 0 ? `${count.format(people.deactivated)} deactivated` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}
