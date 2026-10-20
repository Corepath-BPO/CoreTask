import {
  DEFAULT_PROJECT_APP_EVENTS,
  PROJECT_APPS,
  PROJECT_APP_EVENTS,
  PROJECT_APP_EVENT_LABEL,
  PROJECT_APP_INFO,
  PROJECT_APP_NAME_MAX,
  appAcceptsUrl,
  type ProjectApp,
  type ProjectAppEvent,
} from '@coretask/contracts';
import type { ProjectAppConnection } from '@coretask/types';
import {
  Blocks,
  Gamepad2,
  Hash,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSlackChannels, useSlackStatus } from '@/features/integrations/hooks/use-slack';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/format';

import {
  useConnectProjectApp,
  useDisconnectProjectApp,
  useProjectApps,
  useTestProjectApp,
  useUpdateProjectApp,
} from '../../hooks/use-project-apps';

/** Generic marks, not the tools' logos: the label carries the name. */
const APP_ICON: Record<ProjectApp, LucideIcon> = {
  SLACK: Hash,
  TEAMS: Users,
  GOOGLE_CHAT: MessageCircle,
  DISCORD: Gamepad2,
};

type Editing =
  { mode: 'connect'; app: ProjectApp } | { mode: 'edit'; connection: ProjectAppConnection };

/**
 * Customize › Apps — Asana's "Get started with apps".
 *
 * A gallery of the chat tools a project can post to, and the channels it is
 * connected to: each with what it posts, whether its last post went through,
 * a switch, a test message, and a way out.
 */
export function CustomizeAppsSection({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  canEdit: boolean;
}) {
  const { data: apps, isLoading } = useProjectApps(canEdit ? workspaceId : undefined, projectId);
  const update = useUpdateProjectApp(workspaceId, projectId);
  const test = useTestProjectApp(workspaceId, projectId);
  const disconnect = useDisconnectProjectApp(workspaceId, projectId);
  const [editing, setEditing] = useState<Editing | null>(null);

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        Apps post this project’s updates to your team’s chat. Ask a project editor to connect one.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Get started with apps</h3>
        <p className="text-xs text-muted-foreground">
          Build integrated workflows with the tools your team uses the most.
        </p>
      </div>

      <ul className="grid gap-2" aria-label="Apps you can add">
        {PROJECT_APPS.map((app) => {
          const Icon = APP_ICON[app];
          const info = PROJECT_APP_INFO[app];
          return (
            <li key={app} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{info.label}</p>
                <p className="text-xs text-muted-foreground">{info.blurb}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Add ${info.label}`}
                onClick={() => setEditing({ mode: 'connect', app })}
              >
                Add
              </Button>
            </li>
          );
        })}
      </ul>

      <section className="space-y-2" aria-labelledby="apps-connected">
        <h3 id="apps-connected" className="text-xs font-medium text-muted-foreground">
          Connected to this project
        </h3>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !apps || apps.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center">
            <Blocks className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No apps yet.</p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Connected apps">
            {apps.map((connection) => (
              <ConnectedApp
                key={connection.id}
                connection={connection}
                busy={update.isPending}
                onToggle={(enabled) =>
                  update.mutate({ appId: connection.id, payload: { enabled } })
                }
                onTest={() => test.mutate(connection.id)}
                onEdit={() => setEditing({ mode: 'edit', connection })}
                onDisconnect={() => disconnect.mutate(connection.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <AppDialog
          key={editing.mode === 'edit' ? editing.connection.id : editing.app}
          editing={editing}
          workspaceId={workspaceId}
          projectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function statusLine(connection: ProjectAppConnection): { text: string; failing: boolean } {
  if (!connection.enabled) {
    return connection.disabledReason
      ? { text: `Switched off: ${connection.disabledReason}`, failing: true }
      : { text: 'Off', failing: false };
  }
  if (connection.lastDeliveryStatus === 'FAILED' && connection.lastDeliveryAt) {
    return {
      text: `Last post failed ${formatRelativeTime(connection.lastDeliveryAt)}`,
      failing: true,
    };
  }
  if (connection.lastSuccessAt) {
    return { text: `Last posted ${formatRelativeTime(connection.lastSuccessAt)}`, failing: false };
  }
  return { text: 'Nothing posted yet', failing: false };
}

function ConnectedApp({
  connection,
  busy,
  onToggle,
  onTest,
  onEdit,
  onDisconnect,
}: {
  connection: ProjectAppConnection;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  const Icon = APP_ICON[connection.app];
  const info = PROJECT_APP_INFO[connection.app];
  const status = statusLine(connection);
  const posts = connection.events.map((event) => PROJECT_APP_EVENT_LABEL[event].toLowerCase());

  return (
    <li className="space-y-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {connection.name}
            <span className="font-normal text-muted-foreground">
              {' '}
              · {connection.slackChannel ? 'CoreTask Slack app' : info.label}
            </span>
          </p>
          {connection.urlHint !== connection.name && (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {connection.urlHint}
            </p>
          )}
        </div>
        <Switch
          checked={connection.enabled}
          disabled={busy}
          aria-label={`Post to ${connection.name}`}
          onCheckedChange={onToggle}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More for ${connection.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!connection.enabled} onSelect={onTest}>
              <Send />
              Send a test message
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDisconnect}>
              <Trash2 />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-xs text-muted-foreground">Posts when {joinWords(posts)}.</p>
      <p className={cn('text-xs', status.failing ? 'text-destructive' : 'text-muted-foreground')}>
        {status.text}
      </p>
    </li>
  );
}

/** "a, b or c" — the events read as one sentence. */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? 'nothing';
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

function AppDialog({
  editing,
  workspaceId,
  projectId,
  onClose,
}: {
  editing: Editing;
  workspaceId: string | undefined;
  projectId: string;
  onClose: () => void;
}) {
  const connect = useConnectProjectApp(workspaceId, projectId);
  const update = useUpdateProjectApp(workspaceId, projectId);
  const app = editing.mode === 'edit' ? editing.connection.app : editing.app;
  const info = PROJECT_APP_INFO[app];

  const [url, setUrl] = useState('');
  const [name, setName] = useState(editing.mode === 'edit' ? editing.connection.name : '');
  const [events, setEvents] = useState<ProjectAppEvent[]>(
    editing.mode === 'edit' ? editing.connection.events : [...DEFAULT_PROJECT_APP_EVENTS],
  );

  // A new Slack app posts as the CoreTask app when the workspace has it —
  // buttons and all — and through a pasted webhook otherwise.
  const connectingSlack = editing.mode === 'connect' && app === 'SLACK';
  const slack = useSlackStatus(connectingSlack ? workspaceId : undefined);
  const botAvailable = connectingSlack && Boolean(slack.data?.installation);
  const [via, setVia] = useState<'app' | 'webhook'>('app');
  const usingApp = botAvailable && via === 'app';
  const channels = useSlackChannels(workspaceId, usingApp);
  const [channelId, setChannelId] = useState('');

  const pending = connect.isPending || update.isPending;
  const urlLooksWrong = !usingApp && url.trim() !== '' && !appAcceptsUrl(app, url);
  const ready =
    events.length > 0 &&
    (editing.mode === 'edit' || (usingApp ? channelId !== '' : url.trim() !== '')) &&
    !pending;

  const toggle = (event: ProjectAppEvent, on: boolean) =>
    setEvents((current) =>
      on
        ? PROJECT_APP_EVENTS.filter(
            (candidate) => candidate === event || current.includes(candidate),
          )
        : current.filter((candidate) => candidate !== event),
    );

  const submit = () => {
    if (!ready) return;
    if (editing.mode === 'edit') {
      update.mutate(
        { appId: editing.connection.id, payload: { name: name.trim(), events } },
        { onSuccess: onClose },
      );
    } else {
      connect.mutate(
        {
          app,
          ...(usingApp ? { slackChannelId: channelId } : { url: url.trim() }),
          ...(name.trim() ? { name: name.trim() } : {}),
          events,
        },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing.mode === 'edit' ? `Edit ${editing.connection.name}` : `Add ${info.label}`}
          </DialogTitle>
          <DialogDescription>
            {editing.mode === 'edit'
              ? 'Change what this channel hears about.'
              : usingApp
                ? 'The CoreTask Slack app posts this project’s updates to a channel, with buttons to complete a task or take it.'
                : `${info.howTo} Updates from this project will be posted there.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {botAvailable && (
            <div role="radiogroup" aria-label="How to post" className="grid grid-cols-2 gap-2">
              {(
                [
                  ['app', 'As the CoreTask app', 'Buttons on each task'],
                  ['webhook', 'Incoming webhook', 'A URL you paste'],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={via === value}
                  onClick={() => setVia(value)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    via === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          )}
          {connectingSlack && !slack.isLoading && !botAvailable && slack.data?.configured && (
            <p className="text-xs text-muted-foreground">
              Connect the CoreTask Slack app in{' '}
              <a href="/integrations/slack" className="underline">
                Integrations › Slack
              </a>{' '}
              to post with buttons instead.
            </p>
          )}
          {usingApp && (
            <Field
              label="Channel"
              htmlFor="app-channel"
              hint="Public channels, and private ones the app has been invited to."
            >
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="app-channel" className="w-full">
                  <SelectValue
                    placeholder={channels.isLoading ? 'Asking Slack…' : 'Choose a channel'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(channels.data ?? []).map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.isPrivate ? '🔒 ' : '#'}
                      {channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {channels.isError && (
                <p className="text-xs text-destructive">
                  Slack did not list the channels. Try again.
                </p>
              )}
            </Field>
          )}
          {editing.mode === 'connect' && !usingApp && (
            <Field label="Webhook URL" htmlFor="app-url">
              <Input
                id="app-url"
                value={url}
                autoFocus
                inputMode="url"
                placeholder={info.placeholder}
                onChange={(event) => setUrl(event.target.value)}
              />
              {urlLooksWrong && (
                <p className="text-xs text-destructive">
                  That does not look like a {info.label} webhook URL.
                </p>
              )}
            </Field>
          )}
          <Field
            label="Channel name"
            htmlFor="app-name"
            hint={
              usingApp
                ? 'How it is listed here. The channel’s own name when left empty.'
                : `How it is listed here. ${info.label} when left empty.`
            }
          >
            <Input
              id="app-name"
              value={name}
              maxLength={PROJECT_APP_NAME_MAX}
              placeholder="e.g. #maintenance"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium">Post when</legend>
            {PROJECT_APP_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={events.includes(event)}
                  onCheckedChange={(next) => toggle(event, next === true)}
                />
                {PROJECT_APP_EVENT_LABEL[event]}
              </label>
            ))}
            {events.length === 0 && (
              <p className="text-xs text-destructive">Choose at least one.</p>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {editing.mode === 'edit' ? 'Save' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
