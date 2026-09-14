# The custom field system

How a field gets defined, where its values live, and what happens when somebody
tries to delete one.

For statuses and priorities — which are user-defined but _not_ custom fields —
see [custom-fields.md](custom-fields.md). For sharing one field across projects,
see [field-library.md](field-library.md). For how a field becomes a column, see
[list-view-columns.md](list-view-columns.md).

## A field is a definition, not a column

`CustomField` is owned by a **workspace**. It becomes usable on a project
through a `ProjectCustomField` row, and it becomes _visible_ by being named in a
view's columns. Three separate facts, deliberately:

| Fact                                               | Where it lives         |
| -------------------------------------------------- | ---------------------- |
| This field exists, and is a NUMBER called "Effort" | `CustomField`          |
| Project Alpha uses it, requires it, and wants to   | `ProjectCustomField`   |
| hear when it changes                               |                        |
| The List view shows it third, 120px wide           | `ProjectView.settings` |

Collapsing any two of them loses something. Definition-with-project means the
same field cannot be reused. Definition-with-column means a field you scroll
past stops existing.

`isRequired`, `notifyOnChange` and `position` sit on the association rather than
the definition, because they are answers to "how does _this project_ use it" —
Alpha may require a field that Beta merely offers, and Alpha's collaborators may
want an inbox line for a "Launch date" change that Beta's do not.

## The eleven types

`TEXT`, `NUMBER`, `RATING`, `FORMULA`, `DATE`, `CHECKBOX`, `SINGLE_SELECT`,
`MULTI_SELECT`, `PEOPLE`, `URL`, `EMAIL`.

Every one of them has a working editor (or, for a formula, a working
renderer), a working cell, and — where the type can be compared — working
filter operators. That is the entry condition: a type is added to the enum when
a task can hold a value of it, not when the picker can name it. `RELATION` and
`ROLLUP` are named in the spec and deliberately absent from the enum until that
is true of them, because a field type that only creates a name is worse than
one that is missing: the missing one does not lose anybody's data.

Two of the eleven deserve a word:

- **`RATING`** is a bounded whole number — one to `maxRating` stars, three to
  ten of them. It is stored, filtered and sorted exactly like a `NUMBER`; the
  bounds and the star cell are the whole difference. There is no separate
  "currency" type either: a currency is a `NUMBER` with a display format.
- **`FORMULA`** is worked out on read and never stored. See
  [ADR 0015](../decisions/0015-formula-fields-computed-on-read.md) for why. The
  expression grammar lives in `@coretask/contracts` (`formula.ts`): `+ - * /`,
  parentheses, numeric literals, `days_between(a, b)` and `today()`, over the
  project's `NUMBER`, `RATING`, `DATE` and other `FORMULA` fields. References
  are by field id — `{field:<uuid>}` — so a rename never breaks a formula; the
  editor shows `{Effort}` and converts at the edges. A formula may not name
  itself, loop through another formula, nest more than five deep, or reference
  more than twenty fields. Its cell is read-only for everybody, `PUT` on it is a
  `422`, and it is hidden from the bulk bar, the rule builder and the import.
  Because nothing is stored there is nothing to filter or sort on; a filter
  naming a formula is refused by name.

`isComputed` on the field-type catalog is the one flag every editor and picker
checks, so a computed type is left out everywhere by the same rule.

## Value storage

Typed columns on `TaskCustomFieldValue`, not a JSON blob:

| Field type                      | Column                    |
| ------------------------------- | ------------------------- |
| `TEXT`, `URL`, `EMAIL`          | `textValue`               |
| `NUMBER`, `RATING`              | `numberValue` (Decimal)   |
| `FORMULA`                       | _none_ — computed on read |
| `DATE`                          | `dateValue`               |
| `CHECKBOX`                      | `booleanValue`            |
| `SINGLE_SELECT`, `MULTI_SELECT` | `optionIds[]`             |
| `PEOPLE`                        | `userIds[]`               |

The List filters, sorts and groups by custom fields **server-side** — a project
with ten thousand tasks must not ship all of them for the browser to hide most —
and a JSON blob is opaque to an index. One nullable column per storage class
keeps every value queryable, at one row per `(task, field)`, enforced by the
composite primary key.

`optionIds` and `userIds` are arrays so single- and multi-select share a shape.
A single-select holds at most one; the arity is checked in the service, not the
column.

Formula values are appended to a row's `customFieldValues` after the stored
rows are read, by `FormulaValuesService`, on every path that returns rows: the
view query, the subtask list, and every project work-item read and write. A
project with no formula fields pays one indexed query and nothing else.

## Settings

Each type carries a small settings document — `textMode`, `dateMode`,
`peopleMode`, `decimalPlaces`, `numberFormat`, `currencyCode`, `unitLabel`,
`unitPosition`, `minValue`, `maxValue`, `maxRating`, `expression`,
`placeholder`, `checkedLabel`, `uncheckedLabel`.

`numberFormat` is `PLAIN`, `PERCENTAGE`, `CURRENCY` or `CUSTOM_UNIT`. A currency
carries an ISO 4217 `currencyCode` and is rendered by the client through
`Intl.NumberFormat`, so "1.5" reads as "€1.50" without the server knowing a
symbol; a custom unit carries a `unitLabel` ("pts", "hrs") and a `unitPosition`.
The display keys are optional with no defaults, so a document written before
they existed reads back byte-identical. `NUMBER` and `FORMULA` share this
display half.

It is stored as JSON but never _accepted_ as arbitrary JSON. `@coretask/validation`
declares a Zod schema per type, and the service parses against the schema for the
type being saved. A settings document that names a key belonging to another type,
a `decimalPlaces` of `-1`, a currency without a code, or a formula that does not
parse is a 422 naming the offending path — not a silently stored value that
breaks a cell three screens away. Whether a formula's references exist on the
project is checked in the service, because only it holds the project.

The frontend reads the same documents through `field-settings.ts`, which supplies
a default for every key. A field created before a setting existed still renders.

## Options

Every option is returned, archived ones included, flagged `isArchived`. That is
what lets a cell still holding a hidden option render its label greyed rather
than a dangling id — Asana's "hide option". The pickers offer live options only,
and a value naming an archived option is refused; hiding is reversible from the
edit dialog's "Hidden options" list.

## Removing a field

`DELETE …/custom-fields/:fieldId?mode=` is Asana's two-way choice, made by the
person rather than guessed from state:

| `mode`   | Outcome                                                                    |
| -------- | -------------------------------------------------------------------------- |
| `detach` | the association goes; the definition stays in the library for later        |
| `delete` | every association goes; the definition is deleted, or **archived** if any  |
|          | task holds a value for it                                                  |
| absent   | the older behaviour: detached while another project uses it, archived when |
|          | values exist, deleted otherwise                                            |

A field is easy to recreate; the values people typed into it are not. Archiving
is the honest response to "delete" when deleting would destroy data — and an
archived field can be restored from the library through the workspace-scoped
`PATCH /workspaces/:ws/custom-fields/:fieldId`, the one route that can reach a
definition no project holds any more.

A field that a formula on the project reads cannot leave that project until the
formula does; a formula cannot be attached to a project that lacks its operands.
Both are refused by name.

`type` is absent from the update DTO. Changing it would strand every value in the
old column, and there is no honest conversion from a date to a checkbox.

## Announcing a change

Creating, updating or deleting a field publishes `CUSTOM_FIELD_CHANGED` and emits
`TASK_UPDATED` over the websocket. Automation rules can therefore trigger on a
field changing shape, and open List views refresh their columns without a reload.

A **value** change does four things, in `CustomFieldsService.announce()`:

1. Files a `FIELD_CHANGED` story under the task — `{ fieldId, fieldName, type,
before: { value, label }, after: { value, label }, source }` — with the
   labels resolved now (option names, people's names), so a story written today
   still reads correctly after an option is renamed or a member leaves. The
   panel's feed renders it as "changed Severity from Low to High".
2. Notifies the task's collaborators, minus the actor, when the project's
   association has `notifyOnChange` — Asana's "notify task collaborators when
   this field changes".
3. Emits `task:updated` to the workspace and `work-item:updated` to the project
   room.
4. Publishes `CUSTOM_FIELD_CHANGED` to the rule engine, after the write has
   landed.

`source` is `USER`, `BULK` (the selection bar) or `AUTOMATION`. A rule that
writes a field goes through Prisma in the worker and writes the same story shape
by hand, because the worker cannot reach the service.

The dependency runs one way: `CustomFieldsModule` imports the leaf
`AutomationEventsModule`, `WebsocketModule` and `NotificationsIntegrationModule`,
so a domain module can announce something happened without importing the rule
engine that reacts to it.
