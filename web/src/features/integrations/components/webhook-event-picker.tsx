import {
  SUBSCRIBABLE_WEBHOOK_EVENTS,
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_EVENT_LABEL,
  type SubscribableWebhookEvent,
} from '@coretask/contracts';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface WebhookEventPickerProps {
  value: SubscribableWebhookEvent[];
  onChange: (next: SubscribableWebhookEvent[]) => void;
  disabled?: boolean;
}

/** Emits in the canonical order whatever order boxes were ticked, so saved lists compare equal. */
function canonical(events: Iterable<SubscribableWebhookEvent>): SubscribableWebhookEvent[] {
  const chosen = new Set(events);
  return SUBSCRIBABLE_WEBHOOK_EVENTS.filter((event) => chosen.has(event));
}

export function WebhookEventPicker({ value, onChange, disabled }: WebhookEventPickerProps) {
  const selected = new Set(value);

  const toggle = (event: SubscribableWebhookEvent, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(event);
    else next.delete(event);
    onChange(canonical(next));
  };

  const setGroup = (events: readonly SubscribableWebhookEvent[], checked: boolean) => {
    const next = new Set(selected);
    for (const event of events) {
      if (checked) next.add(event);
      else next.delete(event);
    }
    onChange(canonical(next));
  };

  return (
    <div className="space-y-4">
      {WEBHOOK_EVENT_GROUPS.map((group) => {
        const allChosen = group.events.every((event) => selected.has(event));

        return (
          <fieldset key={group.label} className="space-y-2" disabled={disabled}>
            <div className="flex items-center justify-between">
              <legend className="text-xs font-medium text-muted-foreground">{group.label}</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setGroup(group.events, !allChosen)}
                disabled={disabled}
              >
                {allChosen ? 'Clear' : 'Select all'}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.events.map((event) => {
                const id = `event-${event}`;
                return (
                  <div key={event} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={selected.has(event)}
                      onCheckedChange={(checked) => toggle(event, checked === true)}
                      disabled={disabled}
                    />
                    <Label htmlFor={id} className="font-normal">
                      {WEBHOOK_EVENT_LABEL[event]}
                    </Label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
