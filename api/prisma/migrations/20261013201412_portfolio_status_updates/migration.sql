-- CreateTable
CREATE TABLE "portfolio_status_updates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "authorId" UUID,
    "status" "ProjectStatusValue" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "nextSteps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_status_updates_portfolioId_createdAt_idx" ON "portfolio_status_updates"("portfolioId", "createdAt");

-- AddForeignKey
ALTER TABLE "portfolio_status_updates" ADD CONSTRAINT "portfolio_status_updates_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_status_updates" ADD CONSTRAINT "portfolio_status_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
