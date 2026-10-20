-- AlterTable
ALTER TABLE "automation_delayed_runs" ADD COLUMN     "ruleVersionId" UUID;

-- AlterTable
ALTER TABLE "automation_executions" ADD COLUMN     "ruleVersionId" UUID;

-- AlterTable
ALTER TABLE "automation_rule_versions" ADD COLUMN     "name" VARCHAR(120),
ADD COLUMN     "nodes" JSONB;

-- CreateIndex
CREATE INDEX "automation_executions_ruleVersionId_idx" ON "automation_executions"("ruleVersionId");

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "automation_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every rule that has been published gets a version holding exactly
-- what it runs today — its node tree and its trigger columns — and points at
-- it. Until now the runner read those directly, so this changes no rule's
-- behaviour; it only makes the running definition a row that later edits
-- cannot reach. A rule published through the structured endpoints had its
-- pointer on a version the runner never read; it moves to the snapshot of what
-- actually ran.
WITH snapshots AS (
  SELECT
    r."id" AS "ruleId",
    gen_random_uuid() AS "versionId",
    COALESCE((SELECT MAX(v."version") FROM "automation_rule_versions" v WHERE v."ruleId" = r."id"), 0) + 1 AS "version",
    r."triggerType",
    r."triggerConfig",
    r."name",
    r."createdById",
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', n."id",
            'nodeType', n."nodeType",
            'subtype', n."subtype",
            'configuration', n."configuration",
            'parentNodeId', n."parentNodeId",
            'branchKey', n."branchKey",
            'position', n."position"
          )
          ORDER BY n."position", n."id"
        )
        FROM "automation_nodes" n
        WHERE n."ruleId" = r."id"
      ),
      '[]'::jsonb
    ) AS "nodes"
  FROM "automation_rules" r
  WHERE r."publishedAt" IS NOT NULL
),
inserted AS (
  INSERT INTO "automation_rule_versions"
    ("id", "ruleId", "version", "triggerType", "triggerConfig", "nodes", "name", "createdById", "createdAt", "updatedAt")
  SELECT "versionId", "ruleId", "version", "triggerType", "triggerConfig", "nodes", "name", "createdById", NOW(), NOW()
  FROM snapshots
  RETURNING "id", "ruleId"
)
UPDATE "automation_rules" r
SET "publishedVersionId" = inserted."id"
FROM inserted
WHERE r."id" = inserted."ruleId";
