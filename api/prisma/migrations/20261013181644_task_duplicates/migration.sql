-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "duplicateOfId" UUID;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
