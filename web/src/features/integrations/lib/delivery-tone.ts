import type { WebhookDeliveryStatus } from '@coretask/contracts';
import { AlertCircle, CheckCircle2, Clock3, MinusCircle } from 'lucide-react';

export interface DeliveryTone {
  icon: typeof CheckCircle2;
  iconClass: string;
  badge: 'success' | 'destructive' | 'warning' | 'muted';
  label: string;
}

/** One vocabulary for a delivery's state, shared by the table cell and the history list. */
export function deliveryTone(status: WebhookDeliveryStatus | null): DeliveryTone {
  switch (status) {
    case 'SUCCEEDED':
      return {
        icon: CheckCircle2,
        iconClass: 'bg-success/10 text-success',
        badge: 'success',
        label: 'Delivered',
      };
    case 'FAILED':
      return {
        icon: AlertCircle,
        iconClass: 'bg-destructive/10 text-destructive',
        badge: 'destructive',
        label: 'Failed',
      };
    case 'PENDING':
      return {
        icon: Clock3,
        iconClass: 'bg-warning/10 text-warning',
        badge: 'warning',
        label: 'Pending',
      };
    default:
      return {
        icon: MinusCircle,
        iconClass: 'bg-muted text-muted-foreground',
        badge: 'muted',
        label: 'No deliveries yet',
      };
  }
}
