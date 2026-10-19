-- CreateTable
CREATE TABLE "project_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(7) NOT NULL,
    "parts" TEXT[],
    "blueprint" JSONB NOT NULL,
    "sourceProjectId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_templates_workspaceId_idx" ON "project_templates"("workspaceId");

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
