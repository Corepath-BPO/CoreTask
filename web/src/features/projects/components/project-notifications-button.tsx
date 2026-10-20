import {
  PROJECT_NOTIFICATION_HINT,
  PROJECT_NOTIFICATION_KINDS,
  PROJECT_NOTIFICATION_LABEL,
  type ProjectNotificationKind,
} from '@coretask/contracts';
import { Bell, BellOff } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';

import {
  useProjectNotificationSettings,
  useSetProjectNotificationSettings,
} from '../hooks/use-project-members';

/**
 * Asana's bell beside a project's name: what this project tells you about.
 * Only a project's members hear from it, so only they get the bell. The
 * choice is fetched when the menu opens rather than with every header.
 */
export function ProjectNotificationsButton({
  workspaceId,
  projectId,
  projectName,
}: {
  workspaceId: string | undefined;
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useProjectNotificationSettings(workspaceId, projectId, open);
  const save = useSetProjectNotificationSettings(workspaceId, projectId);
  const chosen = data?.notifyOn ?? [];

  const toggle = (kind: ProjectNotificationKind, on: boolean) =>
    save.mutate(on ? [...chosen, kind] : chosen.filter((entry) => entry !== kind));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Notifications for ${projectName}`}
          title="Notifications"
          disabled={!workspaceId}
        >
          {data && chosen.length === 0 ? <BellOff /> : <Bell />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Notify me about</p>
          <p className="text-xs text-muted-foreground">
            In your inbox — and by email too if you chose project news under Settings ›
            Notifications.
          </p>
        </div>
        {data ? (
          <ul className="space-y-2.5" aria-label="Project notifications">
            {PROJECT_NOTIFICATION_KINDS.map((kind) => (
              <li key={kind}>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <Checkbox
                    checked={chosen.includes(kind)}
                    onCheckedChange={(value) => toggle(kind, value === true)}
                    disabled={save.isPending}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{PROJECT_NOTIFICATION_LABEL[kind]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {PROJECT_NOTIFICATION_HINT[kind]}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </PopoverContent>
    </Popover>
  );
}
