-- Super admins run the admin console. Declared before ADMIN so that ordering
-- by role (the member list does) keeps the most privileged first.
ALTER TYPE "WorkspaceRole" ADD VALUE 'SUPER_ADMIN' BEFORE 'ADMIN';

-- Audit lines for cutting a member's access off and giving it back.
ALTER TYPE "ActivityAction" ADD VALUE 'MEMBER_DEACTIVATED' AFTER 'MEMBER_ROLE_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE 'MEMBER_REACTIVATED' AFTER 'MEMBER_DEACTIVATED';

-- A deactivated membership keeps its row, so reactivation restores it whole.
ALTER TABLE "workspace_members" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" UUID;

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
