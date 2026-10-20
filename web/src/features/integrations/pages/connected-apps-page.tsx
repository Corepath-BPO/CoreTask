import type { ConnectedApp } from '@coretask/types';
import { Link2 } from 'lucide-react';
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

import { useConnectedApps, useDisconnectApp } from '../hooks/use-oauth';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * Integrations › Connected apps: the apps this person allowed to act for them.
 * Theirs alone, so open to every member, not only admins.
 */
export function ConnectedAppsPage() {
  const { data: apps, isLoading } = useConnectedApps();
  const disconnect = useDisconnectApp();
  const [leaving, setLeaving] = useState<ConnectedApp | null>(null);

  return (
    <section className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Apps you allowed to act for you. They can do what you can — except manage people, API keys
          and workspaces — until you disconnect them.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (apps ?? []).length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No connected apps"
          description="When you allow a tool to use your CoreTask account, it appears here."
        />
      ) : (
        <ul className="space-y-3" aria-label="Connected apps">
          {(apps ?? []).map((entry) => (
            <li key={entry.app.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">
                      {entry.app.websiteUrl ? (
                        <a
                          href={entry.app.websiteUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:underline"
                        >
                          {entry.app.name}
                        </a>
                      ) : (
                        entry.app.name
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      By {entry.app.publisher} · connected{' '}
                      {dateFormat.format(new Date(entry.connectedAt))}
                      {entry.connections > 1 ? ` · ${entry.connections} connections` : ''}
                      {entry.lastUsedAt
                        ? ` · last used ${dateFormat.format(new Date(entry.lastUsedAt))}`
                        : ' · not used yet'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setLeaving(entry)}>
                    Disconnect
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect “{leaving?.app.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops working for you at once, and the webhooks it set up for you are deleted. You
              can connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnect.isPending}
              onClick={() =>
                leaving && disconnect.mutate(leaving.app.id, { onSuccess: () => setLeaving(null) })
              }
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
