-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "scheduleCursor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "automation_clock_firings" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "firedFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_clock_firings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_clock_firings_taskId_idx" ON "automation_clock_firings"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "automation_clock_firings_ruleId_taskId_firedFor_key" ON "automation_clock_firings"("ruleId", "taskId", "firedFor");

-- AddForeignKey
ALTER TABLE "automation_clock_firings" ADD CONSTRAINT "automation_clock_firings_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_clock_firings" ADD CONSTRAINT "automation_clock_firings_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
