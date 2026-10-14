-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "bundleId" UUID;

-- AlterTable
ALTER TABLE "task_templates" ADD COLUMN     "bundleId" UUID;

-- CreateTable
CREATE TABLE "bundles" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "sourceProjectId" UUID,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "customFieldIds" UUID[],
    "rules" JSONB NOT NULL DEFAULT '[]',
    "taskTemplates" JSONB NOT NULL DEFAULT '[]',
    "parts" TEXT[] DEFAULT ARRAY['SECTIONS', 'FIELDS', 'RULES', 'TASK_TEMPLATES']::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_projects" (
    "bundleId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "appliedVersion" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundle_projects_pkey" PRIMARY KEY ("bundleId","projectId")
);

-- CreateIndex
CREATE INDEX "bundles_workspaceId_idx" ON "bundles"("workspaceId");

-- CreateIndex
CREATE INDEX "bundle_projects_projectId_idx" ON "bundle_projects"("projectId");

-- CreateIndex
CREATE INDEX "automation_rules_bundleId_idx" ON "automation_rules"("bundleId");

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_projects" ADD CONSTRAINT "bundle_projects_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_projects" ADD CONSTRAINT "bundle_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
