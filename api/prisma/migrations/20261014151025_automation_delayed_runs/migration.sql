-- CreateTable
CREATE TABLE "automation_delayed_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "event" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_delayed_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_delayed_runs_status_runAt_idx" ON "automation_delayed_runs"("status", "runAt");

-- AddForeignKey
ALTER TABLE "automation_delayed_runs" ADD CONSTRAINT "automation_delayed_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
