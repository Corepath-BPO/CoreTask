-- Outbound webhooks: an endpoint an admin registers (URL, encrypted signing
-- secret, subscribed event types, optional project), and one delivery row per
-- event × endpoint that records every attempt. The payload is stored as sent so
-- retries and redeliveries sign identical bytes. Deliveries from the "Send a
-- webhook" automation action have no endpoint and carry the rule instead.

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "ActivityEntity" ADD VALUE 'WEBHOOK_ENDPOINT';

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "projectId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" VARCHAR(200),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryStatus" "WebhookDeliveryStatus",
    "lastSuccessAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "endpointId" UUID,
    "ruleId" UUID,
    "eventType" VARCHAR(60) NOT NULL,
    "eventId" UUID NOT NULL,
    "correlationId" UUID,
    "url" VARCHAR(2048) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" VARCHAR(500),
    "error" VARCHAR(500),
    "durationMs" INTEGER,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_workspaceId_enabled_idx" ON "webhook_endpoints"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "webhook_deliveries_workspaceId_createdAt_idx" ON "webhook_deliveries"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_ruleId_idx" ON "webhook_deliveries"("ruleId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_createdAt_idx" ON "webhook_deliveries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_eventId_endpointId_key" ON "webhook_deliveries"("eventId", "endpointId");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
