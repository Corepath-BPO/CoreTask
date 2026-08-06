# Migrating custom fields to the workspace library

`20260805150000_workspace_field_library` moves `CustomField` from project-scoped
to workspace-scoped. It is the riskiest migration in the repository: it drops a
column that every existing field depends on, and it runs against data nobody can
recreate.

It is written to be lossless, guarded, and verifiable — in that order.

## What changes

| Before                                          | After                                          |
| ----------------------------------------------- | ---------------------------------------------- |
| `custom_fields.projectId` names the one project | `project_custom_fields` names every project    |
| `isRequired`, `position` on the definition      | on the association                             |
| unique `(projectId, name)`                      | index on `(workspaceId, name)`, **not** unique |

`workspaceId` already existed on `custom_fields` before this migration; what
changes is that it becomes the _only_ owner.

## The decision: preserve every field, no merging

Two projects in one workspace may each have had a field called "Status", with
different options and different meanings. The migration keeps both, as separate
definitions with separate associations.

Merging on name was rejected because no automatic rule can tell "the same field,
defined twice" from "two fields that happen to share a word" — and a merge is not
reversible once the values have been repointed. Every field keeps its **id**, so
every existing value, filter and saved view column still resolves.

The cost is duplicate names in the library. That is handled in the picker, which
shows the existing field rather than offering to create another — see
[field-library.md](../architecture/field-library.md#duplicate-names-are-allowed).

## Order of operations

1. `CREATE TABLE project_custom_fields` with `ON DELETE CASCADE` on both sides.
2. `INSERT` one association per existing field, carrying `projectId`,
   `position`, `isRequired` and `createdAt` across.
3. **Verify** (below).
4. `ALTER TABLE custom_fields DROP COLUMN "projectId"`.
5. Create the `(workspaceId, name)` index.

The drop is last, and only reached if the verification passed. Steps 1–4 are one
transaction, so a failure leaves the old shape completely intact — there is no
state where the associations are half-built and the column is already gone.

## The verification

Two guards inside the migration, both `RAISE EXCEPTION` on failure, which aborts
the transaction:

```sql
IF field_count <> assoc_count THEN
    RAISE EXCEPTION 'Field library: % field(s) but % association(s)', …
```

- **Count guard** — every field produced exactly one association.
- **Orphan guard** — every association points at a field _and_ a project that
  exist.

On success it emits a notice:

```
NOTICE:  Field library: 4 field(s) migrated, 4 association(s) created
```

## Verification run

Verified against a scratch database rather than asserted. Every migration up to
but excluding this one was applied, representative legacy data inserted, then the
migration run.

**Fixture** — deliberately including the case the decision above is about:

| Field                               | Project | Workspace | `isRequired` |
| ----------------------------------- | ------- | --------- | ------------ |
| Status (`SINGLE_SELECT`, 2 options) | Alpha   | WS One    | false        |
| Status (`SINGLE_SELECT`)            | Beta    | WS One    | true         |
| Effort (`NUMBER`)                   | Alpha   | WS One    | false        |
| Owner (`TEXT`)                      | Gamma   | WS Two    | false        |

Plus 2 option rows and 2 task values.

**Result**

| Measure                           | Before  | After                |
| --------------------------------- | ------- | -------------------- |
| Field definitions                 | 4       | **4**                |
| Project associations              | —       | **4**                |
| Options                           | 2       | **2**                |
| Task values                       | 2       | **2**                |
| `custom_fields.projectId`         | present | **dropped**          |
| Same-named pairs in one workspace | 1       | **1, kept separate** |
| View columns created              | —       | **0**                |
| Conflicts encountered             | —       | **0**                |

Associations after migration:

```
  name  | project | isRequired | position
--------+---------+------------+----------
 Effort | Alpha   | f          |        1
 Owner  | Gamma   | f          |        0
 Status | Alpha   | f          |        0
 Status | Beta    | t          |        0
```

Both "Status" fields survived as distinct definitions, each keeping its own
`isRequired` — Beta's stayed required, Alpha's did not. Nothing was merged,
nothing was lost.

The migration creates **no view columns**: it never touches `project_views`.
Columns are added by people, through the picker, and a migration inventing them
would rearrange views nobody asked it to touch.

### Reproducing it

```bash
docker exec coretask-postgres psql -U coretask -d postgres -c "CREATE DATABASE migration_check;"
```

Apply every migration directory in name order, stopping before
`20260805150000_workspace_field_library`; insert legacy rows; then apply that
migration and compare the counts above.

## Rollback

Forward-only, like every migration here. Restore from a dump to go back — the
`projectId` column is gone and the association table is the only record of which
project a field belonged to.

That is survivable because the migration cannot half-succeed: it either commits
with the guards satisfied, or it aborts with the old shape untouched.

## Application-level compatibility

`CustomFieldsService` reads through the association and rebuilds the previous DTO
shape:

```ts
function resolve(link: FieldLink): ProjectField {
  return { ...link.customField, isRequired: link.isRequired };
}
```

`isRequired` is lifted from the association back onto the field, so existing
clients saw no change on the day the migration ran. The library endpoints came
afterwards, additively.

## Related

- [The custom field system](../architecture/custom-field-system.md)
- [The workspace field library](../architecture/field-library.md)
- [The earlier view migration](project-view-migration.md)
