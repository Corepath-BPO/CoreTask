import { SUBSCRIBABLE_WEBHOOK_EVENTS } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `WebhookSubscription` in `@coretask/types`. */

class SubscriptionProjectDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Leasing' })
  name!: string;
}

export class WebhookSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ type: SubscriptionProjectDto })
  project!: SubscriptionProjectDto;

  @ApiProperty({ example: 'Zapier · Leasing' })
  name!: string;

  @ApiProperty({ example: 'https://hooks.zapier.com/hooks/catch/…' })
  url!: string;

  @ApiProperty({ enum: SUBSCRIBABLE_WEBHOOK_EVENTS, isArray: true })
  events!: string[];

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Why it switched itself off, after repeated failures.',
  })
  disabledReason!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastDeliveryAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CreatedWebhookSubscriptionDto {
  @ApiProperty({ type: WebhookSubscriptionDto })
  subscription!: WebhookSubscriptionDto;

  @ApiProperty({ description: 'Signs every delivery. Shown once.' })
  secret!: string;
}
