-- CreateTable
CREATE TABLE "team_messages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "authorId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_message_replies" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_messages_teamId_createdAt_idx" ON "team_messages"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "team_message_replies_messageId_createdAt_idx" ON "team_message_replies"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_message_replies" ADD CONSTRAINT "team_message_replies_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "team_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_message_replies" ADD CONSTRAINT "team_message_replies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
