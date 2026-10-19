-- CreateEnum
CREATE TYPE "ProjectStatusValue" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ON_HOLD', 'COMPLETE', 'DROPPED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_UPDATE';

-- CreateTable
CREATE TABLE "project_status_updates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" UUID,
    "status" "ProjectStatusValue" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "nextSteps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_messages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_message_replies" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_status_updates_projectId_createdAt_idx" ON "project_status_updates"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_messages_projectId_createdAt_idx" ON "project_messages"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_message_replies_messageId_createdAt_idx" ON "project_message_replies"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_message_replies" ADD CONSTRAINT "project_message_replies_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "project_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_message_replies" ADD CONSTRAINT "project_message_replies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
