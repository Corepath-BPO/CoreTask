-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "nextOccurrenceId" UUID,
ADD COLUMN     "recurrence" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_nextOccurrenceId_key" ON "tasks"("nextOccurrenceId");
