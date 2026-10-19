-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "bookmarkedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notifications_userId_archivedAt_idx" ON "notifications"("userId", "archivedAt");
