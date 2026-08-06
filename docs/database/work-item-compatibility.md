# Work-item storage: what changed, and what deliberately did not

## The decision

Tasks and tickets keep their own tables. The unification is an application-layer
façade, not a schema merge.

A merge was considered and rejected on three grounds:

1. **It is not reversible.** Once `task_custom_field_values.taskId`,
   `comments.taskId`, `attachments.ticketId` and every activity `entityId` have
   been repointed at a new table, going back means reconstructing which row came
   from where.
2. **Ticket identity is external.** `CORE-1042` has been quoted in email and
   pasted into chat. A merge that reissues or reinterprets keys breaks
   references outside the system, where nothing can be migrated.
3. **The shapes genuinely differ.** Statuses, priorities, hierarchy, severity,
   reporter, resolution timestamps. A merged table is mostly-null columns plus a
   discriminator, which is the same façade with worse ergonomics.

## Migrations applied

### `20260806120000_tickets_join_project_sections`

Purely additive. Every column nullable, no backfill, existing rows untouched.

```sql
ALTER TABLE "tickets" ADD COLUMN "sectionId" UUID;
ALTER TABLE "tickets" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN "archivedAt" TIMESTAMP(3);
```

Plus `ON DELETE SET NULL` to `sections` — deleting a section must not delete the
tickets filed in it, the same rule tasks follow — and an index matching the one
tasks use for "everything in this section, in order".

Until this ran, a ticket could name a project but had nowhere to sit inside it.
"Add a ticket to this column" was not something the schema could express.

The migration ends with an assertion that no ticket sits in a section belonging
to another project. Nothing could violate it — the column was created moments
earlier — but stating the constraint where it is cheapest to check makes it
checkable later.

### `20260806140000_project_default_work_item_type`

```sql
CREATE TYPE "CreatableWorkItemType" AS ENUM ('TASK', 'TICKET');
ALTER TABLE "projects"
  ADD COLUMN "defaultWorkItemType" "CreatableWorkItemType" NOT NULL DEFAULT 'TASK';
```

The enum holds **only the creatable types**, not all four in the shared
contract. A project defaulting to `MILESTONE` would render "+ Add milestone" on
a button whose click the API refuses. Adding a member later is one line,
deliberately gated on that type working end to end:

```sql
ALTER TYPE "CreatableWorkItemType" ADD VALUE 'MILESTONE';
```

The backfill reads each project's own rows rather than setting `TASK`
everywhere: a project holding more tickets than tasks is a ticketing project
whatever it was called, and defaulting it to `TASK` would make those people pick
"Ticket" from a menu forever.

**Verification.** The `TICKET` branch does not fire on the development data —
every project there is task-heavy — so it was exercised on a scratch database
covering all four cases:

| Fixture      | tasks | tickets | result   |
| ------------ | ----- | ------- | -------- |
| Ticket heavy | 1     | 3       | `TICKET` |
| Task heavy   | 3     | 1       | `TASK`   |
| Tied         | 2     | 2       | `TASK`   |
| Empty        | 0     | 0       | `TASK`   |

Ties keep `TASK` — the comparison is strict `>`, the conservative side.

Development data after the migration: 3 projects, all `TASK`, matching their
counts.

### Section default status

`Section.defaultStatusId` already existed and was read by the move logic, but
nothing could write it — no API accepted it, no screen offered it. It only ever
held null, so the behaviour the code documented never actually happened. The
create and update payloads now accept it, guarded so the status must belong to
this project or the workspace-wide set. No schema change was needed.

## Known limitations

### Tickets have no custom-field values

`task_custom_field_values` is keyed to a task. `ProjectWorkItem.customFieldValues`
is therefore always `[]` for a ticket, and the List renders those cells read-only
on ticket rows rather than pretending an edit will stick.

Making it polymorphic is its own migration with its own verification. Two
approaches, neither started:

- add a nullable `ticketId` alongside `taskId` with a check constraint that
  exactly one is set — smaller, keeps the existing index useful;
- introduce `work_item_custom_field_values` keyed by `(workItemId, workItemType)`
  and migrate the existing rows — cleaner, and a data migration over every value
  ever recorded.

### Tickets have no hierarchy

`parentId` is always null for a ticket and the API refuses one as a child. A
subtask created from the List is always a `TASK`, whatever the project defaults
to.

### Tickets are archived, not deleted

There is no delete route for a ticket — the key is external identity, and
deleting one leaves a dangling reference in somebody's inbox. `archivedAt` now
exists for this and the work-item queries filter on it.

### Two lookups per id

A work-item id does not say which table it came from, so `getById` asks both.
That is the cost of not merging, and it is two indexed primary-key lookups —
cheaper than the migration that would avoid it.

## If a merge is ever wanted

The façade is the migration path, not an obstacle to it. `ProjectWorkItem` is
already the shape a merged table would produce, so a future change would:

1. create `work_items` with the union of columns;
2. copy both tables in, preserving ids so every foreign key still resolves;
3. repoint the repositories at it, one at a time, behind the same service;
4. leave `tasks` and `tickets` as views over it until nothing reads them.

Step 3 is possible only because the repositories are the sole writers. That is
the property worth preserving.

## See also

- [Project work items](../architecture/project-work-items.md)
- [Work items API](../api/project-work-items.md)
