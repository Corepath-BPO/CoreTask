# Custom fields API

All routes require a bearer token and pass `WorkspaceMemberGuard`. The workspace
comes from the verified route scope, never from the body — see
[authentication.md](authentication.md).

Creating, updating and deleting a field require **MANAGER**; reading requires
membership. Writing a *value* requires membership, not MANAGER: filling in a
field is ordinary work.

Every response is the standard envelope, `{ "success": true, "data": … }`.

## Definitions

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId/custom-fields`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | fields this project uses (archived excluded) |
| `POST` | `/` | define a new field and associate it |
| `POST` | `/:fieldId/attach` | associate an existing workspace field |
| `GET` | `/:fieldId` | one field |
| `PATCH` | `/:fieldId` | rename, re-describe, change settings or `isRequired` |
| `DELETE` | `/:fieldId` | detach, archive or delete — see below |

### `POST /`

```json
{
  "name": "Severity",
  "type": "SINGLE_SELECT",
  "description": "How badly this bites",
  "isRequired": false,
  "settings": {},
  "options": [
    { "label": "Low",  "colorToken": "blue" },
    { "label": "High", "colorToken": "amber" }
  ]
}
```

`type` is required and immutable afterwards — it is absent from the `PATCH` DTO
entirely, because changing it would strand every existing value in the wrong
column.

A name already used in the workspace is **accepted**, not rejected. The picker
surfaces the existing field instead; see
[field-library.md](../architecture/field-library.md#duplicate-names-are-allowed).

`settings` is validated against a per-type schema. An unknown key, or one
belonging to a different type, is a `422` naming the path — it is never stored
unexamined.

### `POST /:fieldId/attach`

Associates an existing workspace field with this project. The field's options and
settings come with it, because they belong to the definition. Returns `409` if
the project already uses it.

Separate from `POST /` deliberately: defining a field and adopting one are
different acts, and one endpoint that guesses between them by inspecting the body
turns a typo into a duplicate definition.

### `DELETE /:fieldId`

Three outcomes, chosen from state rather than from a flag:

| Situation | Outcome | Effect |
| --- | --- | --- |
| another project uses it | detached | the field survives elsewhere |
| last project, values exist | archived | hidden here, values retained |
| last project, no values | deleted | gone |

Always `200` with the resulting field, so a client can tell which happened.

## Options

| Method | Path |
| --- | --- |
| `POST` | `/:fieldId/options` |
| `PATCH` | `/:fieldId/options/:optionId` |
| `DELETE` | `/:fieldId/options/:optionId` |

An option still held by a task is archived rather than deleted, so cells keep
rendering its label instead of a dangling id.

## Values

Base: `/api/v1/workspaces/:workspaceId/tasks/:taskId/custom-fields`

| Method | Path | Purpose |
| --- | --- | --- |
| `PUT` | `/:fieldId` | set the value |
| `DELETE` | `/:fieldId` | clear it |

`PUT` because setting a value is idempotent — there is one value per
`(task, field)`, enforced by a composite primary key.

The body carries the column appropriate to the type:

```json
{ "textValue": "…" }
{ "numberValue": 7 }
{ "dateValue": "2026-05-20T00:00:00.000Z" }
{ "booleanValue": true }
{ "optionIds": ["019f…"] }
{ "userIds": ["019f…"] }
```

Values are validated against the **definition**, not the request. A select value
must name a live option *of that field* — it cannot borrow an id from another
field, or one archived precisely to retire it. A people value must be a member of
this workspace. Without that, a custom field is a way to store arbitrary ids
against a task.

## Errors

| Status | When |
| --- | --- |
| `403` | not a member, or not MANAGER for a definition change |
| `404` | field not in this workspace — the same answer as "does not exist" |
| `409` | already attached |
| `422` | settings, arity or option/member validation failed |

`404` rather than `403` for a field in another workspace is deliberate: a
distinguishable "exists but forbidden" confirms the id is real.

Stack traces are never returned in production; the response carries a
`requestId` that matches the server log.
