import { WEBHOOK_EVENT_LABEL } from '@coretask/contracts';
import type { WebhookEndpoint } from '@coretask/types';
import { History, KeyRound, MoreHorizontal, Pencil, Send, Trash2, Webhook } from 'lucide-react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/lib/utils';

import { useSetWebhookEnabled } from '../hooks/use-webhooks';
import { DeliveryStatusBadge } from './delivery-status-badge';

interface WebhookTableProps {
  workspaceId: string | undefined;
  webhooks: WebhookEndpoint[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (webhook: WebhookEndpoint) => void;
  onDeliveries: (webhook: WebhookEndpoint) => void;
  onTest: (webhook: WebhookEndpoint) => void;
  onRotate: (webhook: WebhookEndpoint) => void;
  onDelete: (webhook: WebhookEndpoint) => void;
}

const HEADERS = ['Endpoint', 'Events', 'Project', 'Enabled', 'Last delivery', ''] as const;
const VISIBLE_EVENT_BADGES = 3;

export function WebhookTable({
  workspaceId,
  webhooks,
  isLoading,
  onCreate,
  onEdit,
  onDeliveries,
  onTest,
  onRotate,
  onDelete,
}: WebhookTableProps) {
  if (!isLoading && webhooks.length === 0) {
    return (
      <EmptyState
        icon={Webhook}
        title="No webhook endpoints yet"
        description="Add the URL of an n8n Webhook node, or any HTTPS endpoint, and choose which events it should hear about."
        action={
          <Button onClick={onCreate}>
            <Webhook className="size-4" aria-hidden="true" />
            Add endpoint
          </Button>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[840px] text-sm" aria-label="Webhook endpoints">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            {HEADERS.map((header, index) => (
              <th
                key={index}
                scope="col"
                className="px-3 py-2 text-xs font-medium text-muted-foreground"
              >
                {header || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 2 }).map((_, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  {HEADERS.map((_header, cell) => (
                    <td key={cell} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            : webhooks.map((webhook) => (
                <WebhookRow
                  key={webhook.id}
                  workspaceId={workspaceId}
                  webhook={webhook}
                  onEdit={onEdit}
                  onDeliveries={onDeliveries}
                  onTest={onTest}
                  onRotate={onRotate}
                  onDelete={onDelete}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}

type RowProps = Omit<WebhookTableProps, 'webhooks' | 'isLoading' | 'onCreate'> & {
  webhook: WebhookEndpoint;
};

function WebhookRow({
  workspaceId,
  webhook,
  onEdit,
  onDeliveries,
  onTest,
  onRotate,
  onDelete,
}: RowProps) {
  const toggle = useSetWebhookEnabled(workspaceId);
  const hiddenEvents = webhook.events.length - VISIBLE_EVENT_BADGES;
  const autoDisabled = !webhook.enabled && webhook.disabledReason !== null;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="max-w-xs px-3 py-3">
        <p className="font-medium">{webhook.name}</p>
        <code
          className="block truncate font-mono text-xs text-muted-foreground"
          title={webhook.url}
        >
          {webhook.url}
        </code>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {webhook.events.slice(0, VISIBLE_EVENT_BADGES).map((event) => (
            <Badge key={event} variant="outline" className="text-[11px]">
              {WEBHOOK_EVENT_LABEL[event]}
            </Badge>
          ))}
          {hiddenEvents > 0 && (
            <Badge
              variant="muted"
              className="text-[11px]"
              title={webhook.events
                .slice(VISIBLE_EVENT_BADGES)
                .map((event) => WEBHOOK_EVENT_LABEL[event])
                .join(', ')}
            >
              +{hiddenEvents}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-muted-foreground">{webhook.project?.name ?? 'All projects'}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={webhook.enabled}
            disabled={toggle.isPending}
            aria-label={`${webhook.name} enabled`}
            onCheckedChange={(enabled) => toggle.mutate({ endpointId: webhook.id, enabled })}
          />
          {autoDisabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="warning" tabIndex={0} className="cursor-help">
                  Auto-disabled
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{webhook.disabledReason}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-1">
          <DeliveryStatusBadge status={webhook.lastDeliveryStatus} />
          {webhook.lastDeliveryAt && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatRelativeTime(webhook.lastDeliveryAt)}
            </span>
          )}
          {webhook.consecutiveFailures > 0 && (
            <span className="text-xs text-destructive">
              {webhook.consecutiveFailures} consecutive{' '}
              {webhook.consecutiveFailures === 1 ? 'failure' : 'failures'}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${webhook.name}`}>
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(webhook)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDeliveries(webhook)}>
              <History className="size-4" aria-hidden="true" />
              Recent deliveries
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTest(webhook)} disabled={!webhook.enabled}>
              <Send className="size-4" aria-hidden="true" />
              Send test event
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onRotate(webhook)}>
              <KeyRound className="size-4" aria-hidden="true" />
              Rotate secret
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(webhook)}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
