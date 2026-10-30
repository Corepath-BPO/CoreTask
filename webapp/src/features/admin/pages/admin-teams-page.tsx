import { Link } from '@tanstack/react-router';
import { UsersRound } from 'lucide-react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { formatDate } from '@/lib/utils';

import { useAdminTeams } from '../hooks/use-admin';

const HEADERS = ['Team', 'Lead', 'Members', 'Projects', 'Created'] as const;

/** Every team at a glance; each one is managed on its own page. */
export function AdminTeamsPage() {
  const { workspace } = useActiveWorkspace();
  const { data: teams, isLoading } = useAdminTeams(workspace?.id);

  if (!isLoading && (teams ?? []).length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="No teams yet"
        description="Teams group people and the projects they share."
        action={
          <Button asChild>
            <Link to="/teams">Open Teams</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>Teams</CardTitle>
          <CardDescription>
            {isLoading
              ? 'Loading teams…'
              : `${teams?.length ?? 0} ${teams?.length === 1 ? 'team' : 'teams'}. Open one to change its members.`}
          </CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link to="/teams">Manage teams</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm" aria-label="Teams">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                {HEADERS.map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="px-3 py-2 text-xs font-medium text-muted-foreground"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, index) => (
                    <tr key={index} className="border-b border-border last:border-0">
                      {HEADERS.map((header) => (
                        <td key={header} className="px-3 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : (teams ?? []).map((team) => (
                    <tr
                      key={team.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-3">
                        <Link
                          to="/teams/$teamId"
                          params={{ teamId: team.id }}
                          className="flex items-center gap-2 font-medium hover:underline"
                        >
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: team.color }}
                          />
                          {team.name}
                        </Link>
                        {team.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {team.description}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {team.lead?.name ?? 'No lead'}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{team.memberCount}</td>
                      <td className="px-3 py-3 tabular-nums">{team.projectCount}</td>
                      <td className="px-3 py-3 tabular-nums text-muted-foreground">
                        {formatDate(team.createdAt)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
