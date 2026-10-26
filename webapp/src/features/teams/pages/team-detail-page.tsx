import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Crown, FolderKanban, MessageSquare, Pencil, Users } from 'lucide-react';
import { useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCard, MessageComposer } from '@/features/projects/components/message-thread';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import { TeamFormDialog } from '../components/team-form-dialog';
import { TeamRosterDialog } from '../components/team-roster-dialog';
import {
  useDeleteTeamMessage,
  usePostTeamMessage,
  useReplyToTeamMessage,
  useTeamMessages,
} from '../hooks/use-team-messages';
import { useTeam } from '../hooks/use-teams';

export type TeamTab = 'overview' | 'messages';

/**
 * A team's page — Asana's: who is on it, what it works on, and its own
 * conversations. Overview and Messages are tabs in the address bar, so a
 * notification about a team message lands on the right one.
 */
export function TeamDetailPage({ teamId, tab }: { teamId: string; tab: TeamTab }) {
  const navigate = useNavigate();
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const me = useCurrentUser();
  const { data: team, isLoading, isError } = useTeam(workspaceId, teamId);
  const [editing, setEditing] = useState(false);
  const [roster, setRoster] = useState(false);

  const role = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN) || team?.leadId === me?.id;

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !team) {
    return (
      <EmptyState
        icon={Users}
        title="Team not found"
        description="It may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link to="/teams">Back to teams</Link>
          </Button>
        }
      />
    );
  }

  const tabs: { id: TeamTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'messages', label: 'Messages' },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/teams">
            <ArrowLeft />
            Teams
          </Link>
        </Button>
        <div className="flex flex-wrap items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-2 size-3.5 shrink-0 rounded"
            style={{ backgroundColor: team.color }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{team.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {team.description || 'No description yet.'}
            </p>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit team
            </Button>
          )}
        </div>
        <nav aria-label="Team" className="flex gap-1 border-b">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() =>
                void navigate({
                  to: '/teams/$teamId',
                  params: { teamId },
                  search: entry.id === 'overview' ? {} : { tab: entry.id },
                })
              }
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === entry.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <FolderKanban className="size-4 text-muted-foreground" aria-hidden="true" />
                Projects
              </CardTitle>
              <Badge variant="secondary">{team.projects.length}</Badge>
            </CardHeader>
            <CardContent>
              {team.projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No projects you can open belong to this team yet.
                </p>
              ) : (
                <ul className="divide-y" aria-label="Team projects">
                  {team.projects.map((project) => (
                    <li key={project.id}>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                        className="flex items-center gap-2.5 rounded-md px-1 py-2 text-sm hover:bg-muted/50"
                      >
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: project.color }}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {project.key}
                        </span>
                        {project.isArchived && <Badge variant="muted">Archived</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                Members
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setRoster(true)}>
                {canManage ? 'Manage' : 'View all'}
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2" aria-label="Team members">
                {team.members.map((member) => (
                  <li key={member.id} className="flex items-center gap-2.5 text-sm">
                    <PersonAvatar
                      name={member.name}
                      avatarUrl={member.avatarUrl}
                      className="size-7"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                    {member.id === team.leadId && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Crown className="size-3" aria-hidden="true" />
                        Lead
                      </span>
                    )}
                  </li>
                ))}
                {team.members.length === 0 && (
                  <li className="text-sm text-muted-foreground">Nobody yet.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : (
        <TeamMessages
          workspaceId={workspaceId}
          teamId={teamId}
          teamName={team.name}
          canPost={
            hasAtLeastRole(role, WorkspaceRole.MANAGER) ||
            (hasAtLeastRole(role, WorkspaceRole.MEMBER) &&
              team.members.some((member) => member.id === me?.id))
          }
          canManage={hasAtLeastRole(role, WorkspaceRole.MANAGER)}
          currentUserId={me?.id}
        />
      )}

      {workspaceId && (
        <>
          <TeamFormDialog
            open={editing}
            onOpenChange={setEditing}
            workspaceId={workspaceId}
            team={team}
          />
          <TeamRosterDialog
            open={roster}
            onOpenChange={setRoster}
            workspaceId={workspaceId}
            team={team}
            canManage={canManage}
          />
        </>
      )}
    </div>
  );
}

function TeamMessages({
  workspaceId,
  teamId,
  teamName,
  canPost,
  canManage,
  currentUserId,
}: {
  workspaceId: string | undefined;
  teamId: string;
  teamName: string;
  canPost: boolean;
  canManage: boolean;
  currentUserId: string | undefined;
}) {
  const messages = useTeamMessages(workspaceId, teamId);
  const post = usePostTeamMessage(workspaceId, teamId);
  const reply = useReplyToTeamMessage(workspaceId, teamId);
  const remove = useDeleteTeamMessage(workspaceId, teamId);
  const [composing, setComposing] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Conversations for {teamName} as a whole. Everyone on the team is notified.
        </p>
        {canPost && !composing && (
          <Button size="sm" onClick={() => setComposing(true)}>
            <MessageSquare />
            New message
          </Button>
        )}
      </div>

      {composing && workspaceId && (
        <MessageComposer
          workspaceId={workspaceId}
          placeholder="Write a message to the team…"
          pending={post.isPending}
          onPost={(payload, done) => post.mutate(payload, { onSuccess: done })}
          onCancel={() => setComposing(false)}
        />
      )}

      {messages.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : (messages.data ?? []).length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No messages yet"
          description={canPost ? 'Start a conversation with the team.' : 'Nothing posted yet.'}
        />
      ) : (
        <ul className="space-y-3">
          {(messages.data ?? []).map((message) => (
            <li key={message.id}>
              <MessageCard
                workspaceId={workspaceId}
                message={message}
                canReply={canPost}
                canDelete={canManage || message.author?.id === currentUserId}
                currentUserId={currentUserId}
                replying={reply.isPending}
                onReply={(body, done) =>
                  reply.mutate({ messageId: message.id, body }, { onSuccess: done })
                }
                onDelete={() => remove.mutate(message.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
