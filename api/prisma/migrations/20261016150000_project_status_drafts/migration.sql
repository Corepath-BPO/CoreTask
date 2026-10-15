-- CreateTable
CREATE TABLE "project_status_drafts" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ruleId" UUID,
    "status" "ProjectStatusValue" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "nextSteps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_status_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_status_drafts_projectId_key" ON "project_status_drafts"("projectId");

-- AddForeignKey
ALTER TABLE "project_status_drafts" ADD CONSTRAINT "project_status_drafts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_drafts" ADD CONSTRAINT "project_status_drafts_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
