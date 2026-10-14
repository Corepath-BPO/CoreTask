-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "kind" "TaskKind" NOT NULL DEFAULT 'TASK',
    "priority" "TaskPriority",
    "assigneeId" UUID,
    "dueInDays" INTEGER,
    "subtasks" JSONB NOT NULL DEFAULT '[]',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_templates_projectId_idx" ON "task_templates"("projectId");

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
