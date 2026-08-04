-- AlterTable
ALTER TABLE "workspace_invitations" ADD COLUMN     "teamId" UUID;

-- CreateIndex
CREATE INDEX "workspace_invitations_teamId_idx" ON "workspace_invitations"("teamId");

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
