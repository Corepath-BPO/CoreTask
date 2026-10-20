-- AlterTable
ALTER TABLE "workspace_invitations" ADD COLUMN     "projectId" UUID,
ADD COLUMN     "projectRole" "ProjectMemberRole";

-- CreateIndex
CREATE INDEX "workspace_invitations_projectId_idx" ON "workspace_invitations"("projectId");

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
