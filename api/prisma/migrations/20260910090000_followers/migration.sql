-- Followers: who a task or ticket keeps informed. See the model comment in
-- schema.prisma and docs/architecture/comments-and-collaboration.md.

CREATE TABLE "followers" (
    "id"          UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId"      UUID NOT NULL,
    "taskId"      UUID,
    "ticketId"    UUID,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "followers_taskId_userId_key" ON "followers"("taskId", "userId");
CREATE UNIQUE INDEX "followers_ticketId_userId_key" ON "followers"("ticketId", "userId");
CREATE INDEX "followers_userId_idx" ON "followers"("userId");
CREATE INDEX "followers_workspaceId_idx" ON "followers"("workspaceId");

ALTER TABLE "followers" ADD CONSTRAINT "followers_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "followers" ADD CONSTRAINT "followers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "followers" ADD CONSTRAINT "followers_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "followers" ADD CONSTRAINT "followers_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the set the comment service used to compute on the fly — creator,
-- assignee, reporter, prior commenters, mentioned people — so nobody goes
-- silent the day this lands. Only current members: a row for someone who has
-- left would notify a person who cannot open the item.
--
-- gen_random_uuid() rather than a v7: ids are app-generated (@default(uuid(7)))
-- so the column has no database default, and follower ids are never ordered by.
INSERT INTO "followers" ("id", "workspaceId", "userId", "taskId", "ticketId")
SELECT gen_random_uuid(), s."workspaceId", s."userId", s."taskId", s."ticketId"
FROM (
    SELECT t."workspaceId", t."createdById" AS "userId", t."id" AS "taskId", NULL::uuid AS "ticketId"
    FROM "tasks" t
    UNION
    SELECT t."workspaceId", t."assigneeId", t."id", NULL::uuid
    FROM "tasks" t WHERE t."assigneeId" IS NOT NULL
    UNION
    SELECT k."workspaceId", k."reporterId", NULL::uuid, k."id"
    FROM "tickets" k WHERE k."reporterId" IS NOT NULL
    UNION
    SELECT k."workspaceId", k."assigneeId", NULL::uuid, k."id"
    FROM "tickets" k WHERE k."assigneeId" IS NOT NULL
    UNION
    SELECT c."workspaceId", c."authorId", c."taskId", c."ticketId"
    FROM "comments" c WHERE c."deletedAt" IS NULL
    UNION
    SELECT c."workspaceId", m."userId", c."taskId", c."ticketId"
    FROM "comment_mentions" m JOIN "comments" c ON c."id" = m."commentId"
    WHERE c."deletedAt" IS NULL
) s
JOIN "workspace_members" wm ON wm."workspaceId" = s."workspaceId" AND wm."userId" = s."userId"
WHERE s."taskId" IS NOT NULL OR s."ticketId" IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    rows INTEGER;
    orphans INTEGER;
BEGIN
    SELECT count(*) INTO rows FROM "followers";
    SELECT count(*) INTO orphans FROM "followers"
    WHERE ("taskId" IS NULL AND "ticketId" IS NULL) OR ("taskId" IS NOT NULL AND "ticketId" IS NOT NULL);
    IF orphans <> 0 THEN
        RAISE EXCEPTION 'Followers backfill produced % row(s) pointing at nothing or at both kinds', orphans;
    END IF;
    RAISE NOTICE 'Followers: % row(s) backfilled', rows;
END $$;
