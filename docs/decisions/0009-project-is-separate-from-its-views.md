# 0009. A project is separate from its views

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

CoreTask shipped with the Kanban board _as_ the project page. `/projects/:id`
rendered a header and `SectionBoard`, and there was no other way to look at a
project's tasks.

Adding a list view meant choosing between two shapes:

- the board and the list are alternative renderings of one page, toggled by
  component state
- each is a route, and the project page is a shell that holds whichever is
  selected

The first is less work. It also makes the choice invisible to the URL, so it
cannot survive a refresh, cannot be shared, and does not participate in back or
forward.

There was a deeper version of the same question. If a "view" is a rendering
mode, it is tempting to give each one its own data — a list of tasks for the
list, cards for the board. That is how two representations of the same work
drift apart.

## Decision

**A project owns tasks, sections, fields, views, automations and activity. The
board is one representation of its tasks, not the project itself.**

Concretely:

- each view is a route under `/projects/:id/…`; the bare path redirects to
  `/board`
- `ProjectView` stores _presentation only_ — columns, filters, sorts, grouping,
  density. It never stores tasks.
- every view reads the same rows through `POST /projects/:id/tasks/query`, which
  lives on `TasksService`, so there is exactly one task read path

## Consequences

Good:

- the selected view survives a refresh and can be pasted to a colleague
- deleting a view loses an arrangement, never any work
- a task edited in one view _is_ the same task in the other; there is no
  reconciliation step because there is nothing to reconcile
- Calendar, Timeline and Dashboard can be added as routes without touching how
  tasks are stored or read

Costs:

- more routing than a toggle, and a shell component that renders an outlet
- the board had to be lifted out of the page it had lived in, which is a
  mechanical but non-trivial change to working code
- every view depends on one query endpoint, so a regression there affects all of
  them at once — mitigated by that endpoint being the single place worth testing
  hard

Rejected: giving each view its own endpoint. It would have let the list evolve
independently, at the cost of duplicating filtering, permissions and DTO
mapping — the spec's "do not duplicate task business logic across views" is
right, and the duplication would have been permanent.
