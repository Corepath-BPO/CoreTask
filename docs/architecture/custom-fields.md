# Custom fields, statuses and priorities

Three kinds of user-defined data on a project, sharing one principle: what a
workspace calls something must never determine what the code does with it.

## Custom fields

A `CustomField` belongs to a project. Creating one makes it a usable List column
and a usable filter **immediately** — no frontend change — because operators are
declared per field *kind* rather than per field.

### Value storage

Typed columns on `TaskCustomFieldValue`, not a JSON blob:

| Field type | Column |
| --- | --- |
| `TEXT`, `URL`, `EMAIL` | `textValue` |
| `NUMBER` | `numberValue` (Decimal) |
| `DATE` | `dateValue` |
| `CHECKBOX` | `booleanValue` |
| `SINGLE_SELECT`, `MULTI_SELECT` | `optionIds[]` |
| `PEOPLE` | `userIds[]` |

The List has to filter, sort and group by custom fields **server-side** — a
project with ten thousand tasks must not ship all of them for the browser to hide
most — and a JSON blob is opaque to an index. One nullable column per storage
class keeps every value queryable at one row per `(task, field)`, enforced by the
composite primary key.

`optionIds` and `userIds` are arrays so single- and multi-select share a shape; a
single-select simply holds at most one, and arity is checked in the service.

### Validation

Values are validated against the **definition**, not the request. A select value
must name a live option *of that field* — it cannot borrow an id from another
field, or one archived precisely to retire it. A people value must be a member of
this workspace. Without that, a custom field is a way to store arbitrary ids
against a task.

### Destruction

| Situation | Behaviour |
| --- | --- |
| field with values | archived |
| unused field | deleted |
| option in use | archived |
| unused option | deleted |

A field is easy to recreate; its data is not. An archived option keeps rendering
its label in cells that still hold it, instead of leaving a dangling id.

`type` is absent from the update DTO entirely. Changing it would strand every
value in the old column, and there is no honest conversion from a date to a
checkbox.

## Statuses

`StatusDefinition` is project-scoped with a **workspace fallback**:
`projectId` is nullable, and a null row belongs to the workspace-wide set.

A task may have no project at all, so a workspace-level set has to exist for
those to point at. A project that has defined none uses the workspace set;
defining its *first* status copies the whole set forward, because otherwise
adding one status would silently replace all eight and leave every task pointing
at something the project no longer offers.

### Category is the load-bearing field

`StatusCategory` (`NOT_STARTED`, `ACTIVE`, `BLOCKED`, `COMPLETED`, `CANCELLED`,
`ARCHIVED`) carries the meaning. The name is for people; the category is what
code counts.

A workspace can rename "In Progress" to "Working on it" and dashboards still
register it as active work. Rollups that match on names break the moment anyone
customises their vocabulary — which is the whole reason a workspace would want
custom statuses.

Renaming rewrites the slug too, because the backfill maps by slug and a stale one
would quietly break a re-run. `category` is untouched by a rename.

### Constraint subtlety

`@@unique([workspaceId, projectId, slug])` does **not** constrain the
workspace-level rows. PostgreSQL never treats `NULL` as equal to `NULL` in a
unique index, so any number of duplicate slugs would be accepted where
`projectId IS NULL`. A partial unique index covers that:

```sql
CREATE UNIQUE INDEX status_definitions_workspace_slug_key
  ON status_definitions ("workspaceId", slug)
  WHERE "projectId" IS NULL;
```

## Priorities

`PriorityDefinition` is **workspace-scoped**, not per project. "High" meaning
different things in two projects makes every cross-project view — My Tasks, the
dashboard — incoherent.

`level` is the sort key and the basis of every comparison, so renaming or
reordering never changes what "higher priority" means.

## Deletion guards

Deleting or archiving a status any task still holds is refused, **with the
count**. Otherwise those tasks point at something no picker will offer, with no
way to change them back. Same for priorities.

## Sections are not statuses

`Section.defaultStatusId` exists and is nullable, and stays that way by default.
A section is a workflow column; a status is task state. Coupling them silently is
how "move a card" becomes an unexplained status change. Opting in makes it a
choice.

## Known limitations

- **The legacy enums are still authoritative.** `Task.status` and
  `Task.priority` remain `TaskStatus`/`TaskPriority`; the definition FKs shadow
  them. See [the migration note](../database/project-view-migration.md).
- **Future field types** (`CURRENCY`, `RATING`, `FORMULA`, `RELATION`, …) are
  named in the spec and deliberately absent from the enum until implemented.
- **`Section.defaultStatusId` is stored but not applied.** Nothing reads it yet.
