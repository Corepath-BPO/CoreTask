-- Project privacy: a project is PUBLIC (every workspace member, as before) or
-- PRIVATE (its members plus the workspace's admins). Membership lives in
-- project_members with a role that only narrows the workspace role. Activity
-- lines learn which project they belong to so the workspace feed can leave out
-- what the reader cannot see. Existing leads become their project's first
-- admin; projects with no lead stay public and reachable through the admin
-- override, so nothing is orphaned.

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_MEMBER_ADDED';

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN "projectId" UUID;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "visibility" "ProjectVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "project_members" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "role" "ProjectMemberRole" NOT NULL DEFAULT 'EDITOR',
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateIndex
CREATE INDEX "project_members_workspaceId_userId_idx" ON "project_members"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "project_members_projectId_role_idx" ON "project_members"("projectId", "role");

-- CreateIndex
CREATE INDEX "activity_logs_workspaceId_projectId_createdAt_idx" ON "activity_logs"("workspaceId", "projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "projects_workspaceId_visibility_idx" ON "projects"("workspaceId", "visibility");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill 1: every existing lead who is still in the workspace becomes the
-- project's first admin. Nobody is added by hand here; "who added" stays null.
INSERT INTO "project_members" ("projectId", "userId", "workspaceId", "role", "addedById", "createdAt", "updatedAt")
SELECT p."id", p."leadId", p."workspaceId", 'ADMIN', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "projects" p
JOIN "workspace_members" wm ON wm."workspaceId" = p."workspaceId" AND wm."userId" = p."leadId"
WHERE p."leadId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill 2: activity lines learn their project from the entity they describe.
UPDATE "activity_logs" a SET "projectId" = p."id"
FROM "projects" p
WHERE a."entity" = 'PROJECT' AND a."entityId" = p."id" AND a."projectId" IS NULL;

UPDATE "activity_logs" a SET "projectId" = t."projectId"
FROM "tasks" t
WHERE a."entity" = 'TASK' AND a."entityId" = t."id" AND a."projectId" IS NULL;

UPDATE "activity_logs" a SET "projectId" = k."projectId"
FROM "tickets" k
WHERE a."entity" = 'TICKET' AND a."entityId" = k."id" AND a."projectId" IS NULL;

UPDATE "activity_logs" a SET "projectId" = s."projectId"
FROM "sections" s
WHERE a."entity" = 'SECTION' AND a."entityId" = s."id" AND a."projectId" IS NULL;

UPDATE "activity_logs" a SET "projectId" = COALESCE(t."projectId", k."projectId")
FROM "comments" c
LEFT JOIN "tasks" t ON t."id" = c."taskId"
LEFT JOIN "tickets" k ON k."id" = c."ticketId"
WHERE a."entity" = 'COMMENT' AND a."entityId" = c."id" AND a."projectId" IS NULL;

UPDATE "activity_logs" a SET "projectId" = COALESCE(t."projectId", k."projectId")
FROM "attachments" x
LEFT JOIN "tasks" t ON t."id" = x."taskId"
LEFT JOIN "tickets" k ON k."id" = x."ticketId"
WHERE a."entity" = 'ATTACHMENT' AND a."entityId" = x."id" AND a."projectId" IS NULL;
