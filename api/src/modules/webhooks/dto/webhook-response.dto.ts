import {
  SUBSCRIBABLE_WEBHOOK_EVENTS,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_EVENT_TYPES,
} from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger models mirroring `Webhook*` in `@coretask/types`. */

export class WebhookCreatorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;

  @ApiProperty({ required: false, description: 'True for the hidden account behind an API key.' })
  isServiceAccount?: boolean;
}

export class WebhookProjectRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform Foundation' })
  name!: string;
}

/** Note the absence of the signing secret: it is returned by create and rotate only. */
export class WebhookEndpointDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ example: 'n8n — task sync' })
  name!: string;

  @ApiProperty({ example: 'https://n8n.example.com/webhook/coretask' })
  url!: string;

  @ApiProperty({ enum: SUBSCRIBABLE_WEBHOOK_EVENTS, isArray: true })
  events!: string[];

  @ApiProperty({
    type: WebhookProjectRefDto,
    nullable: true,
    description: 'Null means every project.',
  })
  project!: WebhookProjectRefDto | null;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ nullable: true, example: null })
  disabledReason!: string | null;

  @ApiProperty({ example: 0 })
  consecutiveFailures!: number;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastDeliveryAt!: string | null;

  @ApiProperty({ enum: WEBHOOK_DELIVERY_STATUSES, nullable: true })
  lastDeliveryStatus!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastSuccessAt!: string | null;

  @ApiProperty({ type: WebhookCreatorDto, nullable: true })
  createdBy!: WebhookCreatorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CreatedWebhookEndpointDto {
  @ApiProperty({ type: WebhookEndpointDto })
  endpoint!: WebhookEndpointDto;

  @ApiProperty({
    example: 'whsec_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg',
    description: 'Shown once. Verify `X-CoreTask-Signature` with it.',
  })
  secret!: string;
}

export class WebhookSecretRotationDto {
  @ApiProperty({
    example: 'whsec_…',
    description: 'The new secret; the old one stops verifying now.',
  })
  secret!: string;
}

export class WebhookTestResultDto {
  @ApiProperty({ format: 'uuid', description: 'Follow it in the deliveries list.' })
  deliveryId!: string;
}

export class WebhookDeliveryAttemptDto {
  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty()
  succeeded!: boolean;

  @ApiProperty({ nullable: true, example: 200 })
  responseStatus!: number | null;

  @ApiProperty({ nullable: true, example: null })
  error!: string | null;

  @ApiProperty({ nullable: true, example: 142 })
  durationMs!: number | null;
}

export class WebhookDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  endpointId!: string | null;

  @ApiProperty({ nullable: true, example: 'n8n — task sync' })
  endpointName!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  ruleId!: string | null;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, example: 'task.completed' })
  eventType!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  correlationId!: string | null;

  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: WEBHOOK_DELIVERY_STATUSES })
  status!: string;

  @ApiProperty({ example: 1 })
  attempt!: number;

  @ApiProperty({ example: 5 })
  maxAttempts!: number;

  @ApiProperty({ nullable: true, example: 200 })
  responseStatus!: number | null;

  @ApiProperty({ nullable: true })
  error!: string | null;

  @ApiProperty({ nullable: true })
  durationMs!: number | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  nextAttemptAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  deliveredAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class WebhookDeliveryDetailDto extends WebhookDeliveryDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Exactly the JSON sent.',
  })
  payload!: Record<string, unknown>;

  @ApiProperty({ nullable: true, description: 'First 500 characters of the response.' })
  responseBody!: string | null;

  @ApiProperty({ type: WebhookDeliveryAttemptDto, isArray: true })
  attempts!: WebhookDeliveryAttemptDto[];
}

export class WebhookDeliveryPageDto {
  @ApiProperty({ type: WebhookDeliveryDto, isArray: true })
  items!: WebhookDeliveryDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Pass back as `before` for the next page.',
  })
  nextBefore!: string | null;
}
