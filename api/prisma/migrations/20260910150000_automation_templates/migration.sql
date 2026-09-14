-- The rule library: a rule's graph, snapshotted into a workspace-wide row so it
-- can be started from again in any project. JSON rather than node rows, because
-- a template is only ever read whole and written into a new draft — nothing
-- queries inside it.

-- CreateTable
CREATE TABLE "automation_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "triggerType" VARCHAR(60) NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "references" JSONB NOT NULL DEFAULT '{}',
    "allowChaining" BOOLEAN NOT NULL DEFAULT true,
    "sourceRuleId" UUID,
    "sourceProjectId" UUID,
    "createdById" UUID,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_templates_workspaceId_name_idx" ON "automation_templates"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "automation_templates_sourceRuleId_idx" ON "automation_templates"("sourceRuleId");

-- CreateIndex
CREATE INDEX "automation_templates_sourceProjectId_idx" ON "automation_templates"("sourceProjectId");

-- AddForeignKey
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the source nulls out rather than taking the template with it.
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_sourceRuleId_fkey" FOREIGN KEY ("sourceRuleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_templates" ADD CONSTRAINT "automation_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
