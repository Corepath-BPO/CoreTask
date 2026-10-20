import { SLACK_COMMAND } from '@coretask/contracts';
import { Hash, Link2, MessageSquarePlus, MousePointerClick, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
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
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

import {
  useDisconnectSlack,
  useSlackStatus,
  useStartSlackInstall,
  useUnlinkSlack,
} from '../hooks/use-slack';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const USES = [
  {
    icon: MessageSquarePlus,
    title: `${SLACK_COMMAND} <task name>`,
    body: 'Make a task from any channel. A form opens for the project, assignee and due date.',
  },
  {
    icon: Hash,
    title: 'Create a CoreTask task',
    body: 'On any message, under More actions: a task with the message and a link back to it.',
  },
  {
    icon: MousePointerClick,
    title: 'Buttons on project posts',
    body: 'Mark a task complete or take it, right from the post. Set channels up in a project’s Customize › Apps.',
  },
];

/**
 * Integrations › Slack: the CoreTask Slack app for this workspace.
 *
 * Everyone sees it, because everyone links their own Slack account; only
 * admins connect or disconnect the workspace. What a person does from Slack
 * is done as them, so nothing works for someone until they link.
 */
export function SlackPage() {
  const { workspace } = useActiveWorkspace();
  const { data: status, isLoading } = useSlackStatus(workspace?.id);
  const install = useStartSlackInstall(workspace?.id);
  const disconnect = useDisconnectSlack(workspace?.id);
  const unlink = useUnlinkSlack(workspace?.id);
  const [leaving, setLeaving] = useState(false);

  if (isLoading || !status) {
    return (
      <div role="status" className="max-w-3xl space-y-3">
        <span className="sr-only">Loading Slack</span>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const installation = status.installation;

  return (
    <section className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Slack</h2>
        <p className="text-sm text-muted-foreground">
          Make tasks from Slack, and act on the ones CoreTask posts there, without leaving the
          conversation.
        </p>
      </div>

      {!status.configured ? (
        <EmptyState
          icon={Settings2}
          title="Slack is not set up on this server"
          description="Whoever runs this CoreTask server creates the Slack app and adds its client ID, client secret and signing secret to the server’s settings. The steps are in docs/integrations/slack.md."
        />
      ) : !installation ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">Not connected</p>
              <p className="text-sm text-muted-foreground">
                {status.canManage
                  ? `Connect a Slack workspace to ${workspace?.name ?? 'this workspace'}. Slack asks you to allow the CoreTask app.`
                  : 'Ask a workspace admin to connect Slack.'}
              </p>
            </div>
            {status.canManage && (
              <Button
                disabled={install.isPending || install.isSuccess}
                onClick={() => install.mutate()}
              >
                Add to Slack
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">Connected to {installation.teamName}</p>
                <p className="text-sm text-muted-foreground">
                  {installation.installedBy ? `By ${installation.installedBy.name}, ` : ''}
                  {dateFormat.format(new Date(installation.installedAt))} ·{' '}
                  {installation.linkedPeople === 1
                    ? '1 person linked'
                    : `${installation.linkedPeople} people linked`}
                </p>
              </div>
              {status.canManage && (
                <Button variant="outline" onClick={() => setLeaving(true)}>
                  Disconnect
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
              <div className="flex min-w-0 items-start gap-3">
                <Link2
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {status.me.linked ? 'Your Slack account is linked' : 'Link your Slack account'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {status.me.linked ? (
                      'What you do from Slack is done as you, with your access.'
                    ) : (
                      <>
                        In Slack, type{' '}
                        <code className="rounded bg-muted px-1">{SLACK_COMMAND} link</code> and
                        follow the button. It takes a moment, once.
                      </>
                    )}
                  </p>
                </div>
              </div>
              {status.me.linked && (
                <Button variant="ghost" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
                  Unlink
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">In Slack</h3>
            <ul className="grid gap-2 sm:grid-cols-3">
              {USES.map((use) => (
                <li key={use.title} className="space-y-1.5 rounded-lg border p-3">
                  <use.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-medium">{use.title}</p>
                  <p className="text-xs text-muted-foreground">{use.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {installation?.teamName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The CoreTask app is removed from Slack and everyone’s linked accounts are forgotten.
              Channels the app posts to switch off until Slack is connected again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate(undefined, { onSuccess: () => setLeaving(false) })}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
