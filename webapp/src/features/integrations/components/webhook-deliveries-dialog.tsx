import { WEBHOOK_EVENT_LABEL } from '@coretask/contracts';
import type { WebhookDelivery, WebhookEndpoint } from '@coretask/types';
import { ChevronDown, ChevronRight, Clock3, History, RotateCw } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/utils';

import {
  useRedeliverWebhook,
  useWebhookDeliveries,
  useWebhookDelivery,
} from '../hooks/use-webhooks';
import { deliveryTone } from '../lib/delivery-tone';

interface WebhookDeliveriesDialogProps {
  workspaceId: string | undefined;
  webhook: WebhookEndpoint | null;
  onOpenChange: (open: boolean) => void;
}

/** Newest first; each row expands to the exact JSON that was sent and every attempt. */
export function WebhookDeliveriesDialog({
  workspaceId,
  webhook,
  onOpenChange,
}: WebhookDeliveriesDialogProps) {
  const deliveries = useWebhookDeliveries(workspaceId, webhook?.id ?? null);
  const items = deliveries.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Dialog open={webhook !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-primary" aria-hidden="true" />
            Recent deliveries
          </DialogTitle>
          <DialogDescription>{webhook?.name ?? 'Endpoint'} · newest first</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          {deliveries.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : deliveries.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Deliveries could not be loaded. Close this panel and try again.
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <Clock3 className="mb-3 size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-semibold">Nothing delivered yet</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Send a test event, or wait for one of the subscribed events to happen. Every attempt
                shows up here.
              </p>
            </div>
          ) : (
            <>
              <ol className="space-y-3" aria-label="Deliveries">
                {items.map((delivery) => (
                  <DeliveryItem key={delivery.id} workspaceId={workspaceId} delivery={delivery} />
                ))}
              </ol>
              {deliveries.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={deliveries.isFetchingNextPage}
                    onClick={() => void deliveries.fetchNextPage()}
                  >
                    Load older deliveries
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryItem({
  workspaceId,
  delivery,
}: {
  workspaceId: string | undefined;
  delivery: WebhookDelivery;
}) {
  const [expanded, setExpanded] = useState(false);
  // The payload and attempt history are fetched only when asked for: they are
  // the bulk of a delivery, and most rows are never opened.
  const detail = useWebhookDelivery(workspaceId, expanded ? delivery.id : null);
  const redeliver = useRedeliverWebhook(workspaceId);
  const tone = deliveryTone(delivery.status);
  const StatusIcon = tone.icon;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 rounded-full p-1.5 ${tone.iconClass}`}>
            <StatusIcon className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{tone.label}</p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {delivery.responseStatus !== null ? `HTTP ${delivery.responseStatus} · ` : ''}
              {delivery.durationMs !== null ? `${delivery.durationMs} ms · ` : ''}
              {formatRelativeTime(delivery.updatedAt)} · attempt {delivery.attempt} of{' '}
              {delivery.maxAttempts}
              {delivery.nextAttemptAt
                ? ` · next try ${formatRelativeTime(delivery.nextAttemptAt)}`
                : ''}
            </p>
          </div>
        </div>
        <Badge variant="outline">{WEBHOOK_EVENT_LABEL[delivery.eventType]}</Badge>
      </div>

      {delivery.error && (
        <p className="mt-3 line-clamp-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {delivery.error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <Chevron className="size-3.5" aria-hidden="true" />
          {expanded ? 'Hide payload' : 'Show payload'}
        </button>

        {/* A pending row already has a job waiting on it; the others can be pushed again. */}
        {delivery.status !== 'PENDING' && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={redeliver.isPending}
            onClick={() => redeliver.mutate(delivery.id)}
          >
            <RotateCw className="size-3.5" aria-hidden="true" />
            Redeliver
          </button>
        )}
      </div>

      {expanded &&
        (detail.isLoading ? (
          <Skeleton className="mt-3 h-24 rounded-md" />
        ) : detail.data ? (
          <div className="mt-3 space-y-3">
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              {JSON.stringify(detail.data.payload, null, 2)}
            </pre>
            {detail.data.attempts.length > 1 && (
              <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Attempts">
                {detail.data.attempts.map((attempt, index) => (
                  <li key={attempt.at}>
                    Attempt {index + 1}:{' '}
                    {attempt.succeeded ? 'delivered' : (attempt.error ?? 'failed')}
                    {attempt.responseStatus !== null
                      ? ` (HTTP ${attempt.responseStatus})`
                      : ''} · {formatRelativeTime(attempt.at)}
                  </li>
                ))}
              </ul>
            )}
            {detail.data.responseBody && (
              <p className="text-xs text-muted-foreground">
                Response: <code className="font-mono">{detail.data.responseBody}</code>
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-destructive">The payload could not be loaded.</p>
        ))}
    </li>
  );
}
