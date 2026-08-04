-- CreateEnum
CREATE TYPE "AutomationRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationNodeType" AS ENUM ('TRIGGER', 'CONDITION', 'ACTION', 'BRANCH', 'DELAY');

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIALLY_FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "AutomationRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" VARCHAR(60) NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "publishedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" VARCHAR(30),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_nodes" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "nodeType" "AutomationNodeType" NOT NULL,
    "subtype" VARCHAR(60) NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parentNodeId" UUID,
    "branchKey" VARCHAR(40),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerType" VARCHAR(60) NOT NULL,
    "entityType" VARCHAR(40),
    "entityId" UUID,
    "actorId" UUID,
    "correlationId" UUID NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "skippedReason" VARCHAR(200),
    "error" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_execution_logs" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "nodeId" UUID,
    "nodeType" VARCHAR(30) NOT NULL,
    "subtype" VARCHAR(60) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "message" VARCHAR(500),
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_projectId_status_triggerType_idx" ON "automation_rules"("projectId", "status", "triggerType");

-- CreateIndex
CREATE INDEX "automation_rules_workspaceId_status_idx" ON "automation_rules"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "automation_nodes_ruleId_position_idx" ON "automation_nodes"("ruleId", "position");

-- CreateIndex
CREATE INDEX "automation_nodes_parentNodeId_idx" ON "automation_nodes"("parentNodeId");

-- CreateIndex
CREATE INDEX "automation_executions_ruleId_startedAt_idx" ON "automation_executions"("ruleId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_executions_projectId_status_idx" ON "automation_executions"("projectId", "status");

-- CreateIndex
CREATE INDEX "automation_executions_correlationId_idx" ON "automation_executions"("correlationId");

-- CreateIndex
CREATE INDEX "automation_execution_logs_executionId_createdAt_idx" ON "automation_execution_logs"("executionId", "createdAt");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_nodes" ADD CONSTRAINT "automation_nodes_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_nodes" ADD CONSTRAINT "automation_nodes_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "automation_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_execution_logs" ADD CONSTRAINT "automation_execution_logs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
