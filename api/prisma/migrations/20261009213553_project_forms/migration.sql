-- CreateTable
CREATE TABLE "project_forms" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "token" VARCHAR(64) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sectionId" UUID,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "createdById" UUID,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_forms_token_key" ON "project_forms"("token");

-- CreateIndex
CREATE INDEX "project_forms_projectId_idx" ON "project_forms"("projectId");

-- AddForeignKey
ALTER TABLE "project_forms" ADD CONSTRAINT "project_forms_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
