-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('ASANA');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "source" "ImportSource" NOT NULL,
    "externalWorkspaceId" VARCHAR(64) NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" VARCHAR(40),
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "startedById" UUID,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_refs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "source" "ImportSource" NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "entityId" UUID NOT NULL,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_workspaceId_createdAt_idx" ON "import_runs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "import_runs_source_externalWorkspaceId_idx" ON "import_runs"("source", "externalWorkspaceId");

-- CreateIndex
CREATE INDEX "external_refs_workspaceId_entityType_entityId_idx" ON "external_refs"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_workspaceId_source_entityType_externalId_key" ON "external_refs"("workspaceId", "source", "entityType", "externalId");

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

