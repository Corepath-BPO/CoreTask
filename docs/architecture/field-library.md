# The workspace field library

One definition of "Severity", used by four projects, reported on across all of
them. That is the whole point, and everything below follows from it.

## Why the field moved up a level

A project-scoped field means every project that wants "Severity" defines its own.
Four definitions, four sets of options, four ids — and a cross-project report has
nothing to group by, because those four fields are unrelated as far as the
database is concerned. Renaming one renames one.

So `CustomField` belongs to a workspace, and `ProjectCustomField` records which
projects use it. Adding an existing field to a second project creates an
association, never a copy.

```
CustomField (workspace)
  └── ProjectCustomField (project, isRequired, position)
        └── TaskCustomFieldValue (task, typed columns)
```

## Duplicate names are allowed

There is deliberately **no** unique index on `(workspaceId, name)`.

Two projects may each have had a "Status" field before the library existed, with
different options and different meanings. Merging them on name would silently
combine two things somebody deliberately kept apart — and no automatic rule can
tell "the same field, defined twice" from "two fields that happen to share a
word". So every field kept its own identity through the migration, and creating
a second field with an existing name is permitted.

What the picker does instead is make the existing one impossible to miss:

- searching an existing name shows that field, marked **In this view** or
  offered to add;
- the create option is suppressed when the term exactly matches a field the
  project can already see.

Prevention by visibility, not by constraint. The database stays honest about
what people actually built; the UI makes accidental duplication take effort.

## The catalog endpoint

`GET …/projects/:projectId/field-catalog` answers one question — "what could I
put in this view?" — in four groups:

| Group | Contents |
| --- | --- |
| `fieldTypes` | the nine types, for creating something new |
| `systemFields` | built-in task properties, each with `isInView` |
| `projectFields` | fields this project already uses, each with `isInView` |
| `libraryFields` | fields elsewhere in the workspace, with `usageCount` |

Everything comes back **marked rather than filtered**. A field already on screen
stays in the results with `isInView: true` and is rendered disabled. Filtering it
out was tried and was actively harmful: the picker then saw no field by that name
and offered to create a second one, so searching for the field you already had
was the way to end up with two.

### Search

Matching happens at word starts, on both sides. The query and the candidate text
are each split on non-alphanumerics, and every query word must prefix some
candidate word.

- Substrings do not match: searching `date` used to return the URL and Email
  types, because both descriptions contain "vali**date**".
- Multi-word queries work: comparing the whole query against each word meant
  `Due date` matched nothing at all — no single word starts with two — so a field
  vanished the moment somebody finished typing its name, and the picker offered
  to create a duplicate.
- Word order does not matter, since the words are matched independently.

## Authorization

The catalog is reached through `WorkspaceMemberGuard`, and the workspace id comes
from the verified route scope — never from the request body. `libraryFields` is
built from `customField.findMany({ where: { workspaceId } })`, so a member of one
workspace cannot enumerate another's fields by guessing a project id.

Hiding a field in the frontend is presentation. It is never authorization.

## Adding a library field to a project

`POST …/custom-fields/:fieldId/attach` creates the association. It is a separate
endpoint from `POST …/custom-fields` on purpose: creating a definition and
adopting an existing one are different acts, and a single overloaded endpoint
that decides between them by inspecting the body is how a typo becomes a
duplicate definition.

Attaching brings the field's options and settings with it, because they belong to
the definition. That is what makes reuse worth having — the second project gets
the same choices, not an empty select it has to fill in again.
