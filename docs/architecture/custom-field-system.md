# The custom field system

How a field gets defined, where its values live, and what happens when somebody
tries to delete one.

For statuses and priorities — which are user-defined but *not* custom fields —
see [custom-fields.md](custom-fields.md). For sharing one field across projects,
see [field-library.md](field-library.md). For how a field becomes a column, see
[list-view-columns.md](list-view-columns.md).

## A field is a definition, not a column

`CustomField` is owned by a **workspace**. It becomes usable on a project
through a `ProjectCustomField` row, and it becomes *visible* by being named in a
view's columns. Three separate facts, deliberately:

| Fact | Where it lives |
| --- | --- |
| This field exists, and is a NUMBER called "Effort" | `CustomField` |
| Project Alpha uses it, and requires it | `ProjectCustomField` |
| The List view shows it third, 120px wide | `ProjectView.settings` |

Collapsing any two of them loses something. Definition-with-project means the
same field cannot be reused. Definition-with-column means a field you scroll
past stops existing.

`isRequired` and `position` sit on the association rather than the definition,
because they are answers to "how does *this project* use it" — Alpha may require
a field that Beta merely offers.

## The nine types

`TEXT`, `NUMBER`, `DATE`, `CHECKBOX`, `SINGLE_SELECT`, `MULTI_SELECT`, `PEOPLE`,
`URL`, `EMAIL`.

Every one of them has a working editor, a working cell renderer, and working
filter operators. That is the entry condition — a type is added to the enum when
a task can hold a value of it, not when the picker can name it. `CURRENCY`,
`RATING`, `FORMULA`, `RELATION` and `ROLLUP` are named in the spec and are
deliberately absent from the enum until that is true of them, because a field
type that only creates a name is worse than one that is missing: the missing one
does not lose anybody's data.

## Value storage

Typed columns on `TaskCustomFieldValue`, not a JSON blob:

| Field type | Column |
| --- | --- |
| `TEXT`, `URL`, `EMAIL` | `textValue` |
| `NUMBER` | `numberValue` (Decimal) |
| `DATE` | `dateValue` |
| `CHECKBOX` | `booleanValue` |
| `SINGLE_SELECT`, `MULTI_SELECT` | `optionIds[]` |
| `PEOPLE` | `userIds[]` |

The List filters, sorts and groups by custom fields **server-side** — a project
with ten thousand tasks must not ship all of them for the browser to hide most —
and a JSON blob is opaque to an index. One nullable column per storage class
keeps every value queryable, at one row per `(task, field)`, enforced by the
composite primary key.

`optionIds` and `userIds` are arrays so single- and multi-select share a shape.
A single-select holds at most one; the arity is checked in the service, not the
column.

## Settings

Each type carries a small settings document — `textMode`, `dateMode`,
`peopleMode`, `decimalPlaces`, `numberFormat`, `minValue`, `maxValue`,
`placeholder`, `checkedLabel`, `uncheckedLabel`.

It is stored as JSON but never *accepted* as arbitrary JSON. `@coretask/validation`
declares a Zod schema per type, and the service parses against the schema for the
type being saved. A settings document that names a key belonging to another type,
or a `decimalPlaces` of `-1`, is a 422 naming the offending path — not a silently
stored value that breaks a cell three screens away.

The frontend reads the same documents through `field-settings.ts`, which supplies
a default for every key. A field created before a setting existed still renders.

## Deleting a field

`DELETE` has three outcomes, chosen from the state rather than from a flag on the
request:

| Situation | Outcome |
| --- | --- |
| Another project still uses it | the association is removed; the field survives |
| Last project, and values exist | the field is **archived** |
| Last project, and no values | the field is **deleted** |

A field is easy to recreate; the values people typed into it are not. Archiving
is the honest response to "remove this from my project" when removing it would
destroy data — and archived fields are hidden from the list endpoint, so the
project sees what it asked for either way.

Options follow the same rule: an option in use is archived, so cells still
holding it keep rendering their label rather than a dangling id.

`type` is absent from the update DTO. Changing it would strand every value in the
old column, and there is no honest conversion from a date to a checkbox.

## Announcing a change

Creating, updating or deleting a field publishes `CUSTOM_FIELD_CHANGED` and emits
`TASK_UPDATED` over the websocket. Automation rules can therefore trigger on a
field changing shape, and open List views refresh their columns without a reload.

The dependency runs one way: `CustomFieldsModule` imports the leaf
`AutomationEventsModule` and `WebsocketModule`, so a domain module can announce
something happened without importing the rule engine that reacts to it.
