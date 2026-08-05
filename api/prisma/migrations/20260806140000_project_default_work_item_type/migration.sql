-- What a project's "+ Add" button creates.
--
-- A ticketing project and a delivery project want different things from the
-- same control, and making everybody pick from a menu every time is how the
-- Board ended up with a task-only composer.
--
-- The enum holds only the types that can actually be created. Milestone and
-- Approval are declared in the shared contract so the picker can show them as
-- coming, but a project whose default is a type the API refuses would render a
-- button that fails on click — the "fake type" this upgrade exists to avoid.
-- Adding a member later is one line, deliberately gated on that type working
-- end to end:
--
--     ALTER TYPE "CreatableWorkItemType" ADD VALUE 'MILESTONE';

CREATE TYPE "CreatableWorkItemType" AS ENUM ('TASK', 'TICKET');

ALTER TABLE "projects"
    ADD COLUMN "defaultWorkItemType" "CreatableWorkItemType" NOT NULL DEFAULT 'TASK';

-- Backfilled from how each project is actually used rather than set to TASK
-- everywhere. A project holding more tickets than tasks is a ticketing project,
-- whatever it was called when somebody created it, and defaulting it to TASK
-- would mean every one of those people picks "Ticket" from a menu forever.
--
-- Evidence, not a guess: it reads the rows. A project with neither keeps TASK,
-- which is what the Board's composer already did, so nothing changes for it.
UPDATE "projects" p
SET "defaultWorkItemType" = 'TICKET'
WHERE (SELECT count(*) FROM "tickets" t WHERE t."projectId" = p."id")
    > (SELECT count(*) FROM "tasks" k WHERE k."projectId" = p."id" AND k."parentTaskId" IS NULL);

DO $$
DECLARE
    ticket_default INTEGER;
    task_default INTEGER;
BEGIN
    SELECT count(*) INTO ticket_default FROM "projects" WHERE "defaultWorkItemType" = 'TICKET';
    SELECT count(*) INTO task_default FROM "projects" WHERE "defaultWorkItemType" = 'TASK';

    RAISE NOTICE 'Default work-item type: % project(s) TICKET, % project(s) TASK',
        ticket_default, task_default;
END $$;
