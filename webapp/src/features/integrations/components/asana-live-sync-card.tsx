import type { AsanaLiveSyncStatus } from '@coretask/types';

import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { formatRelativeTime } from '@/lib/utils/format';

import { useSetAsanaLiveSync } from '../hooks/use-asana-import';

interface AsanaLiveSyncCardProps {
  workspaceId: string;
  liveSync: AsanaLiveSyncStatus;
  asanaName: string;
}

/**
 * Live sync's switch and how it is doing: when it last looked at Asana, how
 * many tasks it brought across today, and the last thing that went wrong.
 */
export function AsanaLiveSyncCard({ workspaceId, liveSync, asanaName }: AsanaLiveSyncCardProps) {
  const setLiveSync = useSetAsanaLiveSync(workspaceId);

  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <label htmlFor="asana-live-sync" className="font-medium">
              Live sync
            </label>
            <p className="text-sm text-muted-foreground">
              Changes made in {asanaName} come across within a minute or two, and boards open here
              update by themselves. Asana is only read. A full sync also runs every night, to catch
              anything Asana’s change feed missed.
            </p>
          </div>
          <Switch
            id="asana-live-sync"
            checked={liveSync.enabled}
            disabled={setLiveSync.isPending}
            onCheckedChange={(enabled) => setLiveSync.mutate(enabled)}
          />
        </div>

        {liveSync.enabled && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>{liveSyncState(liveSync)}</li>
            {liveSync.enabledBy && liveSync.enabledAt && (
              <li>
                Switched on by {liveSync.enabledBy.name} {formatRelativeTime(liveSync.enabledAt)}
              </li>
            )}
            {liveSync.lastError && (
              <li className="text-destructive">Last problem: {liveSync.lastError}</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function liveSyncState(liveSync: AsanaLiveSyncStatus): string {
  if (liveSync.fullSyncPending) {
    return 'Starting with a full sync. Changes come across live once it has finished.';
  }
  const parts = [
    liveSync.lastPolledAt
      ? `Checked Asana ${formatRelativeTime(liveSync.lastPolledAt)}`
      : 'Waiting for the first check',
    `${liveSync.changesToday} ${liveSync.changesToday === 1 ? 'task' : 'tasks'} updated today`,
  ];
  if (liveSync.lastChangeAt) parts.push(`last change ${formatRelativeTime(liveSync.lastChangeAt)}`);
  return parts.join(' · ');
}
