# Creating work items

Every way of adding something to a project goes through one mutation and one
endpoint. There are several entry points because there are several places
somebody reasonably reaches for one — but they all do the same thing.

## Entry points

| Where                          | Control                 | Context it supplies                 |
| ------------------------------ | ----------------------- | ----------------------------------- |
| List toolbar                   | split button            | project default type, first section |
| List section foot              | quick-add row           | that section                        |
| List, under an expanded parent | quick-add row           | `parentId`, always a TASK           |
| Board toolbar                  | split button            | project default type, first section |
| Board column foot              | quick-add row           | that column's section               |
| Board trailing column          | "Add section"           | opens the section dialog            |
| Either split menu              | Task / Ticket / Section | explicit choice                     |

## The split button

```
┌──────────────────┬────┐
│  + Add ticket    │ ▼  │
└──────────────────┴────┘
```

The left segment acts immediately on the project's `defaultWorkItemType`. The
common case is adding another of whatever this project mostly holds, and making
that a two-step menu choice every time is the tax the Board's task-only composer
avoided by simply not offering the alternative.

The menu lists **every declared type**. Milestone and Approval appear disabled
and labelled "Coming soon" rather than hidden, because absence makes "coming"
and "never considered" look identical — and offering them would write a task
wearing a milestone's label.

Somebody who may not create sees **no control at all**, not a disabled one. A
disabled button invites clicking it and wondering what is broken.

## Quick create versus the dialog

Adding work is the most repeated thing anybody does, and a dialog per item makes
a list of ten into thirty clicks. The quick-add row opens into an input, submits
on Enter, and **stays open** — the next title can be typed straight away. Its
type is settable per row: a mostly-task project still files the occasional
ticket, and making that a trip to the toolbar is how people stop bothering.

The dialog is the escape hatch for an item that needs an assignee and a due date
the moment it exists. Both write through the same mutation; the difference is
how much is asked for, not what happens after.

Two details worth keeping:

- the quick-add row stays open while its own type menu is open. Radix portals
  the menu outside the row, so DOM containment cannot see it and `relatedTarget`
  alone is not reliable — the menu's open state is the signal. Without it,
  reaching for the type icon closed the row under you.
- the dialog mounts only while open and is keyed by what it starts from, so its
  state is initialised rather than undone by a render that exists to cancel the
  one before it.

## What the server does

```
POST /workspaces/:workspaceId/projects/:projectId/work-items
```

1. Workspace membership — `WorkspaceMemberGuard`.
2. Write permission — MEMBER or above. A guest may look without adding.
3. The type is creatable. Checked in the Zod schema and again in the service;
   a disabled menu item is presentation, and anything can post the body.
4. The project exists in this workspace.
5. The section, if named, belongs to **this** project. A section id from another
   project would file the item somewhere its own project cannot see.
6. The parent, if named, is in this project and is not itself a subtask. One
   level of nesting — a deeper tree needs a recursive rollup and a UI that can
   draw it.
7. Assignees are members of this workspace.
8. Placement: the position is computed from **both** kinds already in the
   section.
9. The record is written — ticket keys are allocated inside the transaction, so
   two concurrent creates serialise rather than racing for the same key.
10. Activity entry, automation event, socket broadcast.

## Defaults

`Project.defaultWorkItemType` decides the button's label and what one click
creates. The database enum holds only `TASK` and `TICKET` — a project defaulting
to a type the API refuses would render a button that fails on click.

Existing projects were backfilled from their own rows: more tickets than tasks
became `TICKET`, everything else stayed `TASK`. See
[the migration](../database/work-item-compatibility.md).

Section defaults come from `Section.defaultStatusId`, which is null unless
somebody chose otherwise, and applies to tasks only.

## See also

- [Project work items](./project-work-items.md)
- [API reference](../api/project-work-items.md)
