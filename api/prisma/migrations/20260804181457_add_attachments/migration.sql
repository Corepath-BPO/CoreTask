-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "uploaderId" UUID,
    "taskId" UUID,
    "ticketId" UUID,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(160) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_objectKey_key" ON "attachments"("objectKey");

-- CreateIndex
CREATE INDEX "attachments_taskId_createdAt_idx" ON "attachments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_ticketId_createdAt_idx" ON "attachments"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_workspaceId_createdAt_idx" ON "attachments"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_status_createdAt_idx" ON "attachments"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
