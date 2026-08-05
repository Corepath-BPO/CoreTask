# Status and priority migration

The riskiest change in the project upgrade, and the one that is **deliberately
incomplete**. Read this before touching `Task.status` or `Task.priority`.

## Current state: both live

`Task` carries four columns where two would do:

```prisma
status               TaskStatus    // legacy enum — AUTHORITATIVE
priority             TaskPriority  // legacy enum — AUTHORITATIVE
statusDefinitionId   String?       // new FK — populated, not yet read
priorityDefinitionId String?       // new FK — populated, not yet read
```

Everything still reads the enums. The FKs are backfilled and maintained but
nothing depends on them. That is the intended state until the cut-over is
verified in a real deployment.

## Why phased

The enums are load-bearing across more of the app than a schema diff suggests:

- `TasksService` filtering, sorting and summaries
- `CLOSED_TASK_STATUSES` in dashboard rollups
- ticket status/priority, which are separate enums that look similar
- the board, My Tasks, and every status/priority badge
- the seed script
- `enum-parity.spec.ts`, which asserts contracts mirror Prisma

A single migration that dropped the enums and repointed all of it would either
work or leave every task in the system with no status. Splitting it means the
irreversible step happens only after the reversible ones are confirmed.

## Steps taken

1. **`20260804201515_add_project_configuration`** — creates
   `status_definitions`, `priority_definitions` and the nullable FK columns.
   Purely additive: no drops, no type changes.
2. **`20260804202000_add_status_definition_workspace_unique`** — the partial
   unique index for workspace-level rows (see
   [custom-fields.md](../architecture/custom-fields.md#constraint-subtlety)).
3. **`prisma/backfill-definitions.ts`** — creates one definition set per
   workspace and links every task.

## Running the backfill

```bash
docker exec -w /app/api coretask-api npx tsx prisma/backfill-definitions.ts
```

A script, not SQL inside a migration, because it has to be **verifiable before
anything reads the new columns** and it has to report rather than assume. It
ends with a count and exits non-zero if any task is unlinked:

```
Status definitions created:    24
Priority definitions created:  15
Tasks newly linked:            18

Tasks total:                   18
Tasks without a status link:   0
Tasks without a priority link: 0

OK: every task is linked to a definition.
```

Idempotent: nothing already present is rewritten, so a second run reports all
zeros. That distinction matters — it is how you tell a real run from a repeat.

It never writes `Task.status` or `Task.priority`.

The enum-to-slug maps are typed `Record<TaskStatus, string>`, so adding a status
to the enum without a mapping **fails to compile**. That is the failure that
would otherwise leave tasks silently unlinked.

New workspaces are covered by `DefinitionsService.ensureWorkspaceDefaults`, so
the backfill and the live path converge without a second migration.

## The cut-over, when you are ready

Not yet done. In order:

1. Confirm `SELECT count(*) FROM tasks WHERE "statusDefinitionId" IS NULL` is 0
   in production, not only in development.
2. Make writes set both the enum and the FK — they already do for the FK via the
   backfill, but `TasksService` still writes only the enum.
3. Switch reads to the definitions: badges, filters, grouping, and crucially the
   rollups, which must move from `CLOSED_TASK_STATUSES` to
   `CLOSED_STATUS_CATEGORIES`.
4. Run with both populated for long enough to trust it.
5. **Only then** a separate migration dropping `Task.status`, `Task.priority`
   and the enums, with the parity spec updated in the same commit.

Step 5 is irreversible and has no safe rollback once data has been written under
the new scheme. Do not fold it into an earlier step.

## Rollback

Steps 1–3 are additive and reversible: drop the new tables and columns and the
application is unchanged, because nothing reads them. That property is the point
of doing it this way, and it survives only until step 5.
