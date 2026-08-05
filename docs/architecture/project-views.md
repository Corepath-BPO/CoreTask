# Project views

A project is not a board. The board is one representation of a project's tasks,
alongside the list and whatever comes later.

```
Project
├── Tasks ──────────────┐
├── Sections            │  read by every view
├── Statuses            │  through one endpoint
├── Custom fields       │
├── Views ──────────────┘
│   ├── List    (built)
│   ├── Board   (built)
│   └── Calendar / Timeline / Dashboard  (modelled, not built)
├── Automations
└── Activity
```

## A view is presentation, never a copy

`ProjectView` stores how tasks are shown — columns, filters, sorts, grouping,
density. It never stores tasks. List and Board read the same rows through
`POST /projects/:id/tasks/query`, so deleting a view loses an arrangement rather
than any work, and a task edited in one view is the same task in the other.

The query lives on `TasksService.listForView`, not in the views module, so there
is exactly one task read path: same include, same DTO, same subtask counts.

## Routing

Each view is a route, not component state:

```
/projects/:id            → redirects to /board
/projects/:id/overview
/projects/:id/list
/projects/:id/board
/projects/:id/automations
```

The choice then survives a refresh, works with back and forward, and can be
pasted to a colleague. The bare path redirects rather than rendering a default,
so there is one canonical URL per view and existing bookmarks still land.

## Scope

| Scope | Owner | Visible to |
| --- | --- | --- |
| `PROJECT` | nobody | every project member |
| `PERSONAL` | one user | that user only |

A shared view has **no owner at all**, which is what stops it disappearing when
its author leaves. Someone else's personal view returns **404, not 403** —
confirming it exists is already more than a stranger should learn.

Guests may create personal views but not shared ones.

## Defaults

The List and Board defaults are created lazily on first read, not backfilled.
Projects existed before views did and new ones are created constantly; a lazy
create means both paths converge without a migration that could run twice.
`skipDuplicates` handles two requests racing.

Two states have no correct answer and are refused:

- the default view cannot be deleted until another takes over — otherwise the
  next visitor lands on nothing
- a personal view cannot become everyone's default

`set-default` clears within the type only, so a project keeps both a default
List and a default Board.

## Settings storage

One validated JSON document on `ProjectView.settings`, not four child tables.
It is read and written whole and never queried by its contents, so splitting it
would turn every view load into joins for no gain.

Validated by `viewSettingsSchema` (Zod) on write **and again on read**. Merging a
partial write is how a settings document ends up in a shape nothing can parse;
re-parsing on read means a document written by an older version opens with
defaults rather than failing.

Settings persist to PostgreSQL, not `localStorage`. Someone who arranges a view
on a laptop expects it on a second machine, and a shared view has to look the
same to everyone who opens it.

## The query contract

Filters, sorts and grouping are a shared contract (`packages/contracts/query.ts`)
compiled to Prisma in `query-compiler.ts`. See
[custom-fields.md](./custom-fields.md) for how custom fields join it.

Operators are declared per field **kind**, not per field. That is what makes a
newly created custom field filterable immediately, with no frontend change.

`POST`, not `GET`, for the task query: a filter set is a nested structure, and
encoding one into a query string means inventing a serialisation both sides must
agree on — which is how injection surfaces get built. Paging and search stay in
the query string where they are readable.

## Known limitations

- **Grouping is section-only in the List.** The contract allows status, priority
  and assignee; the table implements section.
- **No inline cell editing.** Clicking a title opens the existing task dialog.
  Column resizing, pinning and bulk selection are likewise not built.
- **Custom fields are not sortable.** Prisma cannot express the ordering without
  a raw query, and a silently-ignored sort is worse than one never offered.
- **Calendar, Timeline and Dashboard** exist in `ProjectViewType` and nowhere
  else. They are deliberately not half-built.
