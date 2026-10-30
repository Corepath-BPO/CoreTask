-- CreateTable
CREATE TABLE "workspace_departures" (
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "departedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_departures_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateIndex
CREATE INDEX "workspace_departures_userId_idx" ON "workspace_departures"("userId");

-- AddForeignKey
ALTER TABLE "workspace_departures" ADD CONSTRAINT "workspace_departures_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_departures" ADD CONSTRAINT "workspace_departures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: everyone already removed or gone, from the audit trail, who is
-- not a member again. Joined to users because revoking an invitation is
-- logged under the same action with the invitation's id, not a person's.
INSERT INTO "workspace_departures" ("workspaceId", "userId", "departedAt")
SELECT a."workspaceId", a."entityId", MAX(a."createdAt")
FROM "activity_logs" a
JOIN "users" u ON u."id" = a."entityId"
WHERE a."action" = 'MEMBER_REMOVED'
  AND a."entity" = 'WORKSPACE_MEMBER'
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_members" m
    WHERE m."workspaceId" = a."workspaceId" AND m."userId" = a."entityId"
  )
GROUP BY a."workspaceId", a."entityId";
