-- CreateTable
CREATE TABLE "portfolio_messages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "authorId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_message_replies" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_messages_portfolioId_createdAt_idx" ON "portfolio_messages"("portfolioId", "createdAt");

-- CreateIndex
CREATE INDEX "portfolio_message_replies_messageId_createdAt_idx" ON "portfolio_message_replies"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "portfolio_messages" ADD CONSTRAINT "portfolio_messages_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_messages" ADD CONSTRAINT "portfolio_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_message_replies" ADD CONSTRAINT "portfolio_message_replies_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "portfolio_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_message_replies" ADD CONSTRAINT "portfolio_message_replies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
