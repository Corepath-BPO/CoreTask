# Custom fields API

All routes require a bearer token and pass `WorkspaceMemberGuard`. The workspace
comes from the verified route scope, never from the body — see
[authentication.md](authentication.md).

Creating, updating and deleting a field require **MANAGER**; reading requires
membership. Writing a _value_ requires membership, not MANAGER: filling in a
field is ordinary work.

Every response is the standard envelope, `{ "success": true, "data": … }`.

## Definitions

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId/custom-fields`

| Method   | Path               | Purpose                                                                |
| -------- | ------------------ | ---------------------------------------------------------------------- |
| `GET`    | `/`                | fields this project uses (archived excluded)                           |
| `POST`   | `/`                | define a new field and associate it                                    |
| `POST`   | `/:fieldId/attach` | associate an existing workspace field                                  |
| `GET`    | `/:fieldId`        | one field                                                              |
| `PATCH`  | `/:fieldId`        | rename, re-describe, change settings, `isRequired` or `notifyOnChange` |
| `DELETE` | `/:fieldId`        | detach, archive or delete — see below                                  |

And one route with no project in it:

| Method  | Path                                                     | Purpose                                                    |
| ------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `PATCH` | `/api/v1/workspaces/:workspaceId/custom-fields/:fieldId` | rename, re-describe, archive or **restore** the definition |

### `POST /`

```json
{
  "name": "Severity",
  "type": "SINGLE_SELECT",
  "description": "How badly this bites",
  "isRequired": false,
  "notifyOnChange": true,
  "settings": {},
  "options": [
    { "label": "Low", "colorToken": "blue" },
    { "label": "High", "colorToken": "amber" }
  ]
}
```

`type` is one of `TEXT`, `NUMBER`, `RATING`, `FORMULA`, `DATE`, `CHECKBOX`,
`SINGLE_SELECT`, `MULTI_SELECT`, `PEOPLE`, `URL`, `EMAIL`. It is required and
immutable afterwards — it is absent from the `PATCH` DTO entirely, because
changing it would strand every existing value in the wrong column.

`notifyOnChange` sits on this project's use of the field: when true, a change to
the value on a task sends every collaborator of that task (minus whoever made
the change) a `FIELD_CHANGED` notification.

A name already used in the workspace is **accepted**, not rejected. The picker
surfaces the existing field instead; see
[field-library.md](../architecture/field-library.md#duplicate-names-are-allowed).

`settings` is validated against a per-type schema. An unknown key, or one
belonging to a different type, is a `422` naming the path — it is never stored
unexamined.

| Type           | Settings                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `TEXT`         | `textMode` (`SHORT`/`LONG`), `placeholder`, `maxLength`                                                    |
| `NUMBER`       | `numberFormat`, `decimalPlaces` 0–6, `currencyCode`, `unitLabel`, `unitPosition`, `minValue`, `maxValue`   |
| `RATING`       | `maxRating` 3–10 (default 5)                                                                               |
| `FORMULA`      | `expression` (required), plus `numberFormat`, `decimalPlaces`, `currencyCode`, `unitLabel`, `unitPosition` |
| `DATE`         | `dateMode` (`DATE_ONLY`/`DATE_TIME`)                                                                       |
| `PEOPLE`       | `peopleMode` (`SINGLE`/`MULTIPLE`)                                                                         |
| `CHECKBOX`     | `checkedLabel`, `uncheckedLabel`                                                                           |
| `MULTI_SELECT` | `maxSelections`                                                                                            |
| `URL`, `EMAIL` | `placeholder`                                                                                              |

`numberFormat` is `PLAIN`, `PERCENTAGE`, `CURRENCY` (needs a three-letter
`currencyCode`) or `CUSTOM_UNIT` (needs a `unitLabel`, up to 12 characters, and
takes a `unitPosition` of `PREFIX` or `SUFFIX`). The extra keys have no defaults.

#### Formulas

`expression` references fields by id — `{field:<uuid>}` — and allows `+ - * /`,
parentheses, numeric literals, `days_between(a, b)` (whole days from `a` to `b`)
and `today()`. Operands must be this project's `NUMBER`, `RATING`, `DATE` or
`FORMULA` fields; the result must be a number. Refused with `422`, each by
name: an expression that does not parse, a field the project lacks, a `TEXT`
operand, a formula naming itself or looping through another, more than five
levels of nesting, more than twenty references, and `isRequired: true`.

A formula's value is never stored. It is worked out when rows are read and
appended to each row's `customFieldValues` with `number` set (or `null` while
any operand is empty). `PUT` on a formula field is `422`; a filter or sort that
names one is `400`.

### `POST /:fieldId/attach`

Associates an existing workspace field with this project. The field's options and
settings come with it, because they belong to the definition. Returns `409` if
the project already uses it, `400` if it is archived (restore it first), and
`422` for a formula whose operands are not all on this project yet.

Separate from `POST /` deliberately: defining a field and adopting one are
different acts, and one endpoint that guesses between them by inspecting the body
turns a typo into a duplicate definition.

### `DELETE /:fieldId?mode=detach|delete`

Asana's two-way choice, made by the caller:

| `mode`   | Effect                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------- |
| `detach` | the association goes; the definition stays in the library                                                |
| `delete` | every project's association goes; the definition is deleted, or archived if values exist                 |
| absent   | chosen from state: detached while another project uses it, archived when values exist, deleted otherwise |

Always `200` with `{ deleted, archived, detachedProjects }`, so a client can say
which happened. Refused with `422` while a formula on this project reads the
field.

### `PATCH /workspaces/:workspaceId/custom-fields/:fieldId`

```json
{ "name": "Story points", "description": null, "isArchived": false }
```

Acts on the definition, with no project in the URL: a field that was deleted
from its last project and archived has no association left to reach it through,
and this is how the library's **Restore** brings it back, values and all.
MANAGER; `404` for a field in another workspace; `400` for an empty body.

## Options

| Method   | Path                          |
| -------- | ----------------------------- |
| `POST`   | `/:fieldId/options`           |
| `PATCH`  | `/:fieldId/options/:optionId` |
| `DELETE` | `/:fieldId/options/:optionId` |

`PATCH` takes `label`, `colorToken`, `position` and `isArchived` — the last is
Asana's "hide option": hidden from every picker, still returned on the field
with `isArchived: true` so cells holding it keep their label, and refused as a
new value. `DELETE` archives an option still held by a task rather than deleting
it, for the same reason.

## Values

Base: `/api/v1/workspaces/:workspaceId/tasks/:taskId/custom-fields`

| Method   | Path        | Purpose       |
| -------- | ----------- | ------------- |
| `PUT`    | `/:fieldId` | set the value |
| `DELETE` | `/:fieldId` | clear it      |

`PUT` because setting a value is idempotent — there is one value per
`(task, field)`, enforced by a composite primary key.

The body carries the key appropriate to the type:

```json
{ "text": "…" }
{ "number": 7 }
{ "date": "2026-05-20T00:00:00.000Z" }
{ "checkbox": true }
{ "optionIds": ["019f…"] }
{ "userIds": ["019f…"] }
```

`RATING` takes `number`, a whole number from 1 to the field's `maxRating`.
`FORMULA` takes nothing: `422`.

Values are validated against the **definition**, not the request. A select value
must name a live option _of that field_ — it cannot borrow an id from another
field, or one hidden precisely to retire it. A people value must be a member of
this workspace. Without that, a custom field is a way to store arbitrary ids
against a task.

Every write and clear files a `FIELD_CHANGED` story under the task (see
[comments-followers-activity.md](comments-followers-activity.md)), notifies the
task's collaborators when the project asked for it, and publishes
`CUSTOM_FIELD_CHANGED` to the rule engine. Setting a value to what it already
was files nothing.

The selection bar sets a field on several tasks at once through
`POST …/work-items/bulk`; see [project-work-items.md](project-work-items.md).

## Errors

| Status | When                                                                                    |
| ------ | --------------------------------------------------------------------------------------- |
| `400`  | a value that does not fit the field; a filter on a formula; attaching an archived field |
| `403`  | not a member, or not MANAGER for a definition change                                    |
| `404`  | field not in this workspace — the same answer as "does not exist"                       |
| `409`  | already attached                                                                        |
| `422`  | settings, formula, arity or option/member validation failed; setting a formula          |

`404` rather than `403` for a field in another workspace is deliberate: a
distinguishable "exists but forbidden" confirms the id is real.

Stack traces are never returned in production; the response carries a
`requestId` that matches the server log.
