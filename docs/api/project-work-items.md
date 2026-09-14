# Work items API

One set of routes for everything a project holds. Used by the List and the Board
without variation — there is no `createFromList` / `createFromBoard`, because the
endpoint describes what happens to the project, not which screen asked.

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId/work-items`

Every route requires a bearer token and workspace membership
(`WorkspaceMemberGuard`). Writing additionally requires MEMBER or above.

## `GET /` — list

Tasks and tickets in one ordering, interleaved by `position` because they share
a section's position space.

| Parameter             | Notes                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types`               | Comma-separated, e.g. `TASK,TICKET`. **Not** repeated — axios serialises arrays as `types[]=`, which strict validation rejects as an unknown property. |
| `sectionId`           | Restrict to one section.                                                                                                                               |
| `search`              | Case-insensitive title match; for tickets, also the key.                                                                                               |
| `includeArchived`     | Default false.                                                                                                                                         |
| `includeCustomFields` | Values are included per item.                                                                                                                          |
| `limit`               | 1–200, default 200.                                                                                                                                    |
| `cursor`              | Opaque; null when there is nothing further.                                                                                                            |

```json
{
  "success": true,
  "data": {
    "items": [/* ProjectWorkItem */],
    "nextCursor": null
  }
}
```

Top-level items only — subtasks are fetched when a row is expanded. A project of
two hundred tasks would otherwise ship every child nobody looked at.

## `GET /:workItemId`

404 if the item is not in this project, rather than a response that confirms it
exists somewhere else.

## `POST /` — create

```json
{
  "type": "TICKET",
  "title": "Login returns a 500",
  "description": null,
  "sectionId": "…",
  "parentId": null,
  "statusId": null,
  "priorityId": null,
  "assigneeIds": [],
  "startDate": null,
  "startAt": null,
  "dueDate": null,
  "dueAt": null,
  "afterId": null,
  "correlationId": "…"
}
```

`dueDate` and `startDate` are calendar dates — whatever clock arrives is
dropped and the date is stored at UTC midnight. `dueAt` and `startAt` are the
exact instants, sent only when a time of day was chosen; a time on no date is
refused. Tickets keep a date-only deadline and ignore the instants. See
[Task dates, times and rich text](../architecture/task-dates-and-rich-text.md).
`description` is stored as sanitised HTML; plain text is accepted and becomes
one paragraph per line.

`type` must be in `CREATABLE_WORK_ITEM_TYPES` — `TASK` or `TICKET`. `MILESTONE`
and `APPROVAL` are declared in the shared contract so the picker can show them
as coming, and are refused here with 422.

`sectionId` omitted lands the item in the project's first section, so something
created from a toolbar is somewhere visible rather than in a limbo neither view
draws. `null` means no section.

Rejections:

| Status | Cause                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Section from another project; parent from another project; parent is itself a subtask; ticket given a `parentId`; assignee not a workspace member |
| 403    | Caller is below MEMBER                                                                                                                            |
| 422    | Unsupported type, blank title, malformed id                                                                                                       |

## `PATCH /:workItemId` — update

```json
{
  "title": "…",
  "statusId": "…",
  "priorityId": "…",
  "assigneeIds": ["…"],
  "dueDate": "2026-09-05T00:00:00.000Z",
  "dueAt": "2026-09-05T20:00:00.000Z"
}
```

Moving `dueDate` without mentioning `dueAt` carries the time of day to the new
date; sending `dueDate: null` clears both.

`statusId` and `priorityId` accept **either** a definition uuid **or** a legacy
enum value. This is not laxity: a task whose status has not been backfilled has
no definition row, so the read model reports `TODO` as the id, and a ticket's
status is only ever an enum. Whatever the server hands out has to be accepted
back, or setting a status fails on exactly the rows that need it most.

A ticket given a task status (`BACKLOG`) is refused with 400 — the vocabularies
are not interchangeable.

An update that changes nothing is refused with 422. A correlation id alone is
bookkeeping, not a change; accepting it would write an activity entry and fire
automations for an edit nobody made.

## `PATCH /:workItemId/move`

```json
{ "targetSectionId": "…", "afterId": "…", "beforeId": null, "correlationId": "…" }
```

What a Board drag does and what a List drag between section cards does. Give
`afterId` **or** `beforeId`, not both. `targetSectionId: null` detaches the item
from every section.

The sibling list used to compute the new position contains both kinds.

Moving a **task** into a section applies that section's `defaultStatusId` when
one is set. Moving a **ticket** never does — see
[project work items](../architecture/project-work-items.md#what-a-sections-default-status-does-and-does-not).

## `POST /bulk` — one change for a selection

```json
{
  "workItemIds": ["…", "…"],
  "update": {
    "assigneeIds": ["…"],
    "dueDate": "2026-09-05T00:00:00.000Z",
    "dueAt": null,
    "customFieldValues": { "<fieldId>": { "optionIds": ["…"] } }
  },
  "sectionId": "…",
  "archived": true,
  "correlationId": "…"
}
```

What the List's selection bar sends. Any of `update` (status, priority,
assignees, dates, custom field values — never title or description, which are
one row's own words), `sectionId` (a move; `null` detaches) and `archived: true`
may be combined; at least one is required, and up to 100 ids.

`customFieldValues` is keyed by field id and takes, per field, the same body
`PUT …/tasks/:id/custom-fields/:fieldId` takes (`text`, `number`, `date`,
`checkbox`, `optionIds`, `userIds`); up to ten fields per request. Each value is
applied to every **task** in the selection through the field route's own
service — the same validation, the same `FIELD_CHANGED` story (with
`source: "BULK"`), the same rule trigger — and tickets, which hold no field
values, are skipped rather than refused, so a mixed selection still gets its
tasks changed.

Each row goes through the same `update`, `move` and archive paths a single
edit takes, in the order named, so it produces its own activity entry, rules
and socket events — and a move appends, so the rows keep their relative
order. The one `correlationId` rides on every row's event. Returns
`{ "items": [...] }` in the order named, each with its formula values worked
out.

Everything that could fail part-way is checked first: every id must be in
this project (404 and nothing written otherwise), a task status or priority
on a selection that holds a ticket is refused with 400 before any write, and
so is archiving a ticket. Every field named must be on this project (404) and
every value must fit its field (400; 422 for a formula, which nobody sets)
before the first row is written. Archiving needs MANAGER (403 otherwise), as
the task route requires.

## Query settings

`GET /` also takes the open view's settings, so the List and the Board can apply
a change at once whether or not the caller may save it:

| Parameter       | Shape                                             | Effect                                                        |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `filters`       | JSON array of `{ field, operator, value? }`, ≤ 20 | the same conditions a saved view holds, applied in PostgreSQL |
| `sorts`         | JSON array of `{ field, direction }`, ≤ 5         | one ordering over tasks and tickets together                  |
| `groupBy`       | a field reference                                 | leads the ordering, so a group never splits across a page     |
| `showCompleted` | `'true'` or `'false'`                             | `false` hides done tasks (`completedAt`) and resolved tickets |

`field` is a system field (`title`, `status`, `priority`, `sectionId`,
`assigneeId`, `createdById`, `dueDate`, `startDate`, `completedAt`,
`createdAt`, `updatedAt`, `estimatedMinutes`) or `custom:<fieldId>` for a field
on this project. Operators come from `OPERATORS_BY_KIND` in
`@coretask/contracts`; a date value may be a relative token — `@today`,
`@startOfWeek`, `@endOfWeek`, `@startOfNextWeek`, `@endOfNextWeek` — resolved
at query time, Monday-start, UTC midnight.

**Tickets** answer a filter where they can and are excluded where they cannot:

| Filter on                                                               | Tickets                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `title`, `assigneeId`, `sectionId`, `dueDate`, `createdAt`, `updatedAt` | the same column                                           |
| `completedAt`                                                           | `resolvedAt`                                              |
| `createdById`                                                           | `reporterId`                                              |
| `status`, `priority`                                                    | excluded — a task's vocabulary                            |
| `startDate`, `estimatedMinutes`, any custom field                       | excluded, except `IS_EMPTY`, which every ticket satisfies |

**Ordering** is one SQL query over both kinds: a select by its option's
position, people by name, status and priority by their definition's position
(the enum's order as the fallback, and for tickets), text case-insensitively,
`NULLS LAST` in both directions, then `position, id`. A ticket's key for a
custom field, a start date or an estimate is `NULL`, so on those sorts every
ticket lands after the valued tasks. Two reads with equal keys answer in the
same order.

Refused with `400`: a field this project does not have, a formula (worked out
on read, so nothing to compare), a name the compiler does not know. Malformed
JSON, too many entries, or an operator given a value it does not take is `422`
from the schema. Without `sorts` and `groupBy` the read is exactly what it was
— by `position, id` — with the filters applied.

## Events

Each write emits, to the project room:

```
work-item:created   work-item:updated   work-item:moved   work-item:deleted
```

```json
{
  "workspaceId": "…",
  "projectId": "…",
  "workItemId": "…",
  "workItemType": "TICKET",
  "changedFields": ["priority"],
  "workItem": {/* ProjectWorkItem */},
  "fromSectionId": null,
  "toSectionId": "…",
  "actorId": "…",
  "correlationId": "…",
  "occurredAt": "2026-08-06T00:00:00.000Z"
}
```

The legacy `task:*` and `ticket:*` events still fire on the workspace room, so
anything already listening keeps working.

## Activity and automation

Every write records activity with `workItemType` and `source` in its metadata,
and publishes the matching automation trigger — `TASK_CREATED` /
`TICKET_CREATED`, `TASK_STATUS_CHANGED`, `TASK_PRIORITY_CHANGED`,
`TASK_ASSIGNED`, `TASK_COMPLETED`, `TASK_MOVED_TO_SECTION`. Only the triggers
that actually fired: publishing every one on every update would run rules whose
condition never changed.

## See also

- [Creating work items](../architecture/work-item-creation.md)
- [Project work items](../architecture/project-work-items.md)
