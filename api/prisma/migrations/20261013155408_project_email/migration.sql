-- CreateTable
CREATE TABLE "project_email_inboxes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "token" VARCHAR(32) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sectionId" UUID,
    "acceptFrom" VARCHAR(16) NOT NULL DEFAULT 'MEMBERS',
    "addCollaborators" BOOLEAN NOT NULL DEFAULT true,
    "sendUpdates" BOOLEAN NOT NULL DEFAULT true,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_email_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "messageId" VARCHAR(998),
    "fromAddress" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(300),
    "taskId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_email_recipients" (
    "taskId" UUID NOT NULL,
    "address" VARCHAR(320) NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_email_recipients_pkey" PRIMARY KEY ("taskId","address")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_email_inboxes_projectId_key" ON "project_email_inboxes"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_email_inboxes_token_key" ON "project_email_inboxes"("token");

-- CreateIndex
CREATE INDEX "inbound_emails_projectId_receivedAt_idx" ON "inbound_emails"("projectId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_projectId_messageId_key" ON "inbound_emails"("projectId", "messageId");

-- AddForeignKey
ALTER TABLE "project_email_inboxes" ADD CONSTRAINT "project_email_inboxes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_email_recipients" ADD CONSTRAINT "task_email_recipients_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
