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
  "dueDate": null,
  "afterId": null,
  "correlationId": "…"
}
```

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
{ "title": "…", "statusId": "…", "priorityId": "…", "assigneeIds": ["…"], "dueDate": null }
```

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
