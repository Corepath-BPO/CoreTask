# Project view and column API

The endpoints behind the List view: what a view stores, what the picker offers,
and how tasks are queried for it.

All routes require a bearer token and pass `WorkspaceMemberGuard`. Every response
uses the standard envelope.

## Views

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId/views`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | views visible to the caller |
| `POST` | `/` | create a view |
| `GET` | `/:viewId` | one view |
| `PATCH` | `/:viewId` | rename, or replace `settings` |
| `POST` | `/:viewId/duplicate` | copy, as a personal view |
| `POST` | `/:viewId/set-default` | make it the project default |
| `DELETE` | `/:viewId` | remove it |

A personal view is returned only to its owner. Deleting the default is refused
until another view takes over, so a project always has one to land on.

### Column settings

Columns live in `settings.columns`:

```json
{
  "columns": [
    { "field": "title",        "width": 300, "isPinned": true },
    { "field": "assigneeId",   "width": 170 },
    { "field": "custom:019f…", "width": 150 }
  ],
  "groupBy": "sectionId",
  "sort": [{ "field": "position", "direction": "asc" }]
}
```

| Key | Rule |
| --- | --- |
| `field` | a system field key, or `custom:<uuid>` |
| `width` | 60–800; the browser clamps to the same bounds |
| `isPinned` | frozen to the left; the pinned block must lead and be contiguous |

Validated with Zod on write. An unknown key, an out-of-range width or a malformed
field reference is a `422` naming the path — the frontend cannot store arbitrary
JSON here.

`title` is fixed: it stays first and stays pinned regardless of what is stored
for it. See
[list-view-columns.md](../architecture/list-view-columns.md#the-task-column-is-fixed).

A stored `custom:` column whose field has since been deleted is **kept** in
storage and skipped at render. Rewriting the settings would decide that an
archived field is gone for good.

## Field catalog

`GET /api/v1/workspaces/:workspaceId/projects/:projectId/field-catalog`

Everything the add-field picker needs, in one response.

| Parameter | Meaning |
| --- | --- |
| `search` | matched at word starts, per word, on both sides |
| `visible` | comma-separated field refs already in the view |
| `includeArchived` | include archived definitions |

`visible` is **one comma-separated parameter**, not a repeated one. Axios
serializes arrays as `visible[]=…`, which strict validation rejects as an unknown
property.

```json
{
  "fieldTypes":    [{ "type": "NUMBER", "label": "Number", "description": "…" }],
  "systemFields":  [{ "key": "dueDate", "label": "Due date", "isInView": true, "isSortable": true, … }],
  "projectFields": [{ "id": "019f…", "name": "Severity", "usageCount": 2, "isInProject": true, "isInView": true, … }],
  "libraryFields": [{ "id": "019f…", "name": "Team",     "usageCount": 3, "isInProject": false, "isInView": false, … }]
}
```

Fields already in the view come back **marked, not omitted**. `isInView: true`
renders them ticked and disabled. Omitting them is indistinguishable from "no
such field", and caused the picker to offer to create a duplicate of a field the
user was looking straight at.

`libraryFields` is scoped to the verified workspace, so it cannot be used to
enumerate another workspace's fields.

## Tasks for a view

`POST /api/v1/workspaces/:workspaceId/projects/:projectId/tasks/query`

`POST` rather than `GET`: filters nest arbitrarily, and a URL long enough to hold
them is a URL that gets truncated by something in the middle.

```json
{
  "filters": [{ "field": "custom:019f…", "operator": "IS_ANY_OF", "value": ["019f…"] }],
  "sort":    [{ "field": "dueDate", "direction": "asc" }],
  "groupBy": "sectionId"
}
```

Filtering, sorting and grouping all happen in PostgreSQL. A project with ten
thousand tasks must not ship all of them for the browser to hide most.

Operators are declared per field *kind*, so a new custom field is filterable and
sortable the moment it exists — no frontend change.

## Supporting reads

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `…/field-metadata` | fields, statuses, priorities, sections, members for rendering cells |
| `GET` | `…/tasks/:taskId/subtasks` | children, loaded when a row is expanded |

Subtasks are fetched on expand rather than with the parent — a list of two
hundred rows would otherwise fetch every child nobody looked at.

Subtask counts exclude archived children. Counting them unfiltered produced a
badge reading `1/5` on a row that expanded to three.

## Errors

| Status | When |
| --- | --- |
| `403` | not a member; personal view belonging to somebody else |
| `404` | view or project not in this workspace |
| `409` | deleting the default while it is still the only one |
| `422` | settings, filter or column validation failed |
