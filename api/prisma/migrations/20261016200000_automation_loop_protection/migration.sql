-- AlterTable
ALTER TABLE "automation_executions" ADD COLUMN     "actionsRun" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "chainId" UUID,
ADD COLUMN     "idempotencyKey" VARCHAR(120);

-- AlterTable
ALTER TABLE "automation_execution_logs" ADD COLUMN     "followUps" JSONB;

-- CreateIndex
CREATE INDEX "automation_executions_chainId_idx" ON "automation_executions"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_ruleId_idempotencyKey_key" ON "automation_executions"("ruleId", "idempotencyKey");
