import type { WebhookDeliveryStatus } from '@coretask/contracts';

import { Badge } from '@/components/ui/badge';

import { deliveryTone } from '../lib/delivery-tone';

export function DeliveryStatusBadge({ status }: { status: WebhookDeliveryStatus | null }) {
  const tone = deliveryTone(status);
  return <Badge variant={tone.badge}>{tone.label}</Badge>;
}
