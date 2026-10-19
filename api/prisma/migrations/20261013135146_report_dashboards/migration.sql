-- CreateTable
CREATE TABLE "report_dashboards" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ownerId" UUID,
    "charts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_dashboards_workspaceId_idx" ON "report_dashboards"("workspaceId");

-- AddForeignKey
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
