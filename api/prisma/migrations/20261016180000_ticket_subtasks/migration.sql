-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "parentTicketId" UUID;

-- CreateIndex
CREATE INDEX "tasks_parentTicketId_idx" ON "tasks"("parentTicketId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTicketId_fkey" FOREIGN KEY ("parentTicketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
