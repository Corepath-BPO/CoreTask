-- Custom fields become a workspace field library.
--
-- Until now a CustomField belonged to exactly one project, so the same "Risk"
-- field had to be recreated per project and could never be reported on across
-- them. The definition moves to the workspace; which projects use it becomes a
-- separate fact in project_custom_fields.
--
-- Lossless by construction: every existing field keeps its id, its options, and
-- its task values, and gains exactly one association to the project it already
-- belonged to. No field is merged with another, because two projects may each
-- have a "Status" field with different options and merging them would silently
-- destroy one set.
--
-- Prisma runs a migration in a single transaction, so the guards below abort
-- and roll back the whole thing rather than leaving a half-moved model.

-- 1. Where a field is used, and how it behaves there.
CREATE TABLE "project_custom_fields" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "customFieldId" UUID NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_custom_fields_pkey" PRIMARY KEY ("id")
);

-- 2. Backfill: one association per existing field, carrying the per-project
--    facts (position, isRequired) that used to live on the definition.
INSERT INTO "project_custom_fields" (
    "id", "projectId", "customFieldId", "position", "isRequired", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    "projectId",
    "id",
    "position",
    "isRequired",
    "createdAt",
    CURRENT_TIMESTAMP
FROM "custom_fields";

-- 3. Refuse to continue unless every field was carried across. A field left
--    without an association would vanish from its project's UI while its task
--    values sat unreachable in the database.
DO $$
DECLARE
    field_count INTEGER;
    assoc_count INTEGER;
    orphan_count INTEGER;
BEGIN
    SELECT count(*) INTO field_count FROM "custom_fields";
    SELECT count(*) INTO assoc_count FROM "project_custom_fields";

    IF field_count <> assoc_count THEN
        RAISE EXCEPTION
            'Field library backfill mismatch: % custom fields but % associations',
            field_count, assoc_count;
    END IF;

    SELECT count(*) INTO orphan_count
    FROM "project_custom_fields" a
    LEFT JOIN "custom_fields" f ON f."id" = a."customFieldId"
    LEFT JOIN "projects" p ON p."id" = a."projectId"
    WHERE f."id" IS NULL OR p."id" IS NULL;

    IF orphan_count > 0 THEN
        RAISE EXCEPTION
            'Field library backfill produced % association(s) pointing at nothing',
            orphan_count;
    END IF;

    RAISE NOTICE 'Field library: % field(s) migrated, % association(s) created',
        field_count, assoc_count;
END $$;

-- 4. Constraints and indexes, added after the backfill so the insert is not
--    checked row by row against an index it is building.
CREATE UNIQUE INDEX "project_custom_fields_projectId_customFieldId_key"
    ON "project_custom_fields"("projectId", "customFieldId");
CREATE INDEX "project_custom_fields_projectId_position_idx"
    ON "project_custom_fields"("projectId", "position");
CREATE INDEX "project_custom_fields_customFieldId_idx"
    ON "project_custom_fields"("customFieldId");

ALTER TABLE "project_custom_fields"
    ADD CONSTRAINT "project_custom_fields_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_custom_fields"
    ADD CONSTRAINT "project_custom_fields_customFieldId_fkey"
    FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Only now does the definition stop belonging to a project.
--
--    No unique index on (workspaceId, name) replaces the old (projectId, name):
--    two projects may legitimately both have a "Status" field, and a constraint
--    here would fail this migration on exactly the workspaces that most need
--    the library. The picker warns about duplicates instead.
DROP INDEX "custom_fields_projectId_name_key";
DROP INDEX "custom_fields_projectId_position_idx";

ALTER TABLE "custom_fields" DROP CONSTRAINT "custom_fields_projectId_fkey";
ALTER TABLE "custom_fields" DROP COLUMN "projectId";
ALTER TABLE "custom_fields" DROP COLUMN "position";
ALTER TABLE "custom_fields" DROP COLUMN "isRequired";

CREATE INDEX "custom_fields_workspaceId_name_idx"
    ON "custom_fields"("workspaceId", "name");
