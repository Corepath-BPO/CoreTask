-- Tickets become citizens of a project board.
--
-- Until now a ticket could name a project but had nowhere to sit inside it: no
-- section, no ordering. So "create a ticket in this column" was not something
-- the schema could express, and the List and Board could only ever show tasks.
--
-- Purely additive. Every column is nullable with no backfill, so existing
-- tickets are untouched and keep behaving exactly as before — a ticket with no
-- section is simply one nobody has placed on a board.
--
-- Deliberately NOT done here:
--   * no merge of `tasks` and `tickets`. They carry different identity (a
--     ticket's key gets quoted in email) and different history, and a merge is
--     not reversible once values are repointed.
--   * no custom-field values for tickets. `task_custom_field_values` is keyed to
--     a task, and making it polymorphic is its own migration with its own
--     verification. See docs/database/work-item-compatibility.md.

ALTER TABLE "tickets" ADD COLUMN "sectionId" UUID;
ALTER TABLE "tickets" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- SET NULL rather than CASCADE: deleting a section must not delete the tickets
-- filed in it. A task behaves the same way, and for the same reason — the work
-- outlives the column somebody dragged it into.
ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Matches the index tasks use for the same query: "everything in this section,
-- in order", which is what both the board column and the list group ask for.
CREATE INDEX "tickets_projectId_sectionId_position_idx"
    ON "tickets"("projectId", "sectionId", "position");

CREATE INDEX "tickets_archivedAt_idx" ON "tickets"("archivedAt");

DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    -- A ticket may only sit in a section of its own project. Nothing should
    -- violate this yet — the column was created a moment ago — but asserting it
    -- here means the constraint is stated where it is easiest to check later.
    SELECT count(*) INTO orphan_count
    FROM "tickets" t
    JOIN "sections" s ON s."id" = t."sectionId"
    WHERE t."projectId" IS DISTINCT FROM s."projectId";

    IF orphan_count > 0 THEN
        RAISE EXCEPTION
            'Tickets in a section belonging to another project: %', orphan_count;
    END IF;

    RAISE NOTICE 'Tickets can now hold a section and a position.';
END $$;
