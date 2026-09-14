-- Tasks gain a time of day.
--
-- `dueDate` and `startDate` stay the calendar date, stored at UTC midnight, so
-- every reader that only ever cared about the date keeps working. `dueAt` and
-- `startAt` carry the exact instant, and only when somebody chose a time.
-- See docs/architecture/task-dates-and-rich-text.md.
ALTER TABLE "tasks" ADD COLUMN "startAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "dueAt" TIMESTAMP(3);

-- Every existing date was written as a calendar date, except the ones the
-- SET_DUE_DATE automation stamped with the time it happened to run. Normalise
-- them all so a date is a date from here on.
UPDATE "tasks"
SET "dueDate" = date_trunc('day', "dueDate")
WHERE "dueDate" IS NOT NULL AND "dueDate" <> date_trunc('day', "dueDate");

UPDATE "tasks"
SET "startDate" = date_trunc('day', "startDate")
WHERE "startDate" IS NOT NULL AND "startDate" <> date_trunc('day', "startDate");

UPDATE "tickets"
SET "dueDate" = date_trunc('day', "dueDate")
WHERE "dueDate" IS NOT NULL AND "dueDate" <> date_trunc('day', "dueDate");
