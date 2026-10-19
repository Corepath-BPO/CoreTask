-- CreateTable
CREATE TABLE "status_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "ProjectStatusValue",
    "summary" TEXT,
    "nextSteps" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_templates_projectId_idx" ON "status_templates"("projectId");

-- AddForeignKey
ALTER TABLE "status_templates" ADD CONSTRAINT "status_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
