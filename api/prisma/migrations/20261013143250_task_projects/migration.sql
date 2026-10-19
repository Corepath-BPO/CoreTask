-- CreateTable
CREATE TABLE "task_projects" (
    "taskId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sectionId" UUID,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "addedById" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_projects_pkey" PRIMARY KEY ("taskId","projectId")
);

-- CreateIndex
CREATE INDEX "task_projects_projectId_sectionId_position_idx" ON "task_projects"("projectId", "sectionId", "position");

-- AddForeignKey
ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
