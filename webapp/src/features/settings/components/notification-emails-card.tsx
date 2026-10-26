import {
  NOTIFICATION_EMAIL_GROUPS,
  NOTIFICATION_EMAIL_GROUP_LABEL,
  type NotificationEmailGroup,
} from '@coretask/contracts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '../hooks/use-notification-preferences';

/**
 * Settings › Notifications — which inbox notifications also arrive by email,
 * for this workspace. Each box saves as it is ticked; the inbox keeps every
 * notification either way.
 */
export function NotificationEmailsCard({ workspaceId }: { workspaceId: string }) {
  const { data: preferences, isLoading } = useNotificationPreferences(workspaceId);
  const save = useSaveNotificationPreferences(workspaceId);

  const toggle = (group: NotificationEmailGroup, on: boolean) => {
    if (!preferences) return;
    const next = on
      ? NOTIFICATION_EMAIL_GROUPS.filter(
          (candidate) => candidate === group || preferences.emailGroups.includes(candidate),
        )
      : preferences.emailGroups.filter((candidate) => candidate !== group);
    save.mutate({ emailGroups: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Your inbox gets everything. Choose what also comes by email
          {preferences ? ` to ${preferences.emailAddress}` : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !preferences ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <fieldset className="space-y-2.5">
            <legend className="mb-2 text-sm font-medium">Email me when</legend>
            {NOTIFICATION_EMAIL_GROUPS.map((group) => (
              <label key={group} className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={preferences.emailGroups.includes(group)}
                  disabled={save.isPending}
                  onCheckedChange={(next) => toggle(group, next === true)}
                />
                {NOTIFICATION_EMAIL_GROUP_LABEL[group]}
              </label>
            ))}
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
