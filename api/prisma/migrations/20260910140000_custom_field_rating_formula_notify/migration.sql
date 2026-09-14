-- RATING and FORMULA meet the entry condition — an editor and a renderer, with
-- FORMULA's filters refused by design — so they join the enum. Appended in
-- schema.prisma order so `migrate diff` stays silent; neither value is written
-- here, because Postgres refuses to use an enum value in the transaction that
-- added it.

ALTER TYPE "CustomFieldType" ADD VALUE 'RATING';
ALTER TYPE "CustomFieldType" ADD VALUE 'FORMULA';

-- Per project, like isRequired: whether a change to this field is worth
-- telling the task's collaborators about is a decision each project makes.
ALTER TABLE "project_custom_fields"
    ADD COLUMN "notifyOnChange" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
    members INTEGER;
    flagged INTEGER;
BEGIN
    SELECT count(*) INTO members FROM pg_enum WHERE enumtypid = '"CustomFieldType"'::regtype;
    IF members <> 11 THEN
        RAISE EXCEPTION 'CustomFieldType has % member(s), expected 11', members;
    END IF;
    SELECT count(*) INTO flagged FROM "project_custom_fields" WHERE "notifyOnChange";
    RAISE NOTICE 'CustomFieldType: % member(s); % association(s) notify (expected 0)', members, flagged;
END $$;
