# 0010. Typed columns for custom field values

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Custom fields need somewhere to put their values. Three shapes were plausible:

1. **A JSON column on `Task`** — `customFields: { "<fieldId>": value }`
2. **A value table with typed nullable columns** — one row per (task, field)
3. **A value table per type** — `TaskTextValue`, `TaskNumberValue`, …

Option 1 is the least schema. Option 3 is the most normalised. The deciding
constraint came from the List view rather than from storage: the spec requires
filtering, sorting and grouping to happen **server-side**, because a project
with ten thousand tasks must not ship all of them for the browser to hide most.

PostgreSQL can index expressions over JSONB, but only ones you anticipate. A
field created by a user at runtime is exactly the case you cannot anticipate, so
every filter on a JSON column would be a sequential scan over the project's
tasks.

## Decision

**One value table with typed nullable columns**, keyed by
`@@id([taskId, customFieldId])`:

```prisma
textValue    String?
numberValue  Decimal?
dateValue    DateTime?
booleanValue Boolean?
optionIds    String[]  @db.Uuid
userIds      String[]  @db.Uuid
```

with indexes on `(customFieldId, textValue)`, `(customFieldId, numberValue)` and
`(customFieldId, dateValue)`.

Select and people values share an array shape; a single-select holds at most one,
and arity is enforced in the service rather than the schema.

## Consequences

Good:

- every value is queryable and indexed, so filtering scales with the result set
  rather than the project
- the composite primary key makes "one value per task per field" a database
  guarantee, not a service convention
- adding a storage class is a nullable column, not a new table and join

Costs:

- six columns where any given row uses one. The waste is small — nulls are cheap
  in PostgreSQL — but the table is wider than it looks
- the type-to-column mapping exists in two places (the query compiler and the
  value writer) and they must agree. A single shared map would be better and is
  worth doing if a third consumer appears
- sorting by a custom field still is not supported, because Prisma cannot express
  ordering through a relation without a raw query. The columns would allow it;
  the ORM does not

Rejected — JSON — for the indexing reason above. Rejected — per-type tables —
because reading a task's fields would mean six left joins to assemble what is
conceptually one row, and adding a type would mean a migration plus a query
change everywhere values are read.

`ProjectView.settings` went the *other* way and is JSON, which is not an
inconsistency: it is read and written whole and never queried by its contents.
The rule is "index what you filter on", not "avoid JSON".
