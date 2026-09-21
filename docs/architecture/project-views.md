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

| Scope      | Owner    | Visible to           |
| ---------- | -------- | -------------------- |
| `PROJECT`  | nobody   | every project member |
| `PERSONAL` | one user | that user only       |

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
newly created custom field filterable immediately, with no frontend change. The
system fields' capabilities — sortable, filterable, groupable, and whether the
field is a column at all — live in `SYSTEM_FIELD_CATALOG` in the same package,
so the toolbar offers exactly what the compiler accepts.

## The toolbar

Asana's four buttons — Filter, Sort, Group, Options — are wired to the open
view's settings, on the List and the Board alike.

**The request carries the effective settings.** `GET …/work-items` takes
`filters` and `sorts` as JSON, `groupBy` as a field reference and
`showCompleted=false`, rather than a view id. The UI must apply a change
instantly and independently of whether the caller may persist it, and the cache
keys and realtime invalidation are already built on the GET. See
[project-work-items.md](../api/project-work-items.md#query-settings).

**Debounced write, optimistic draft.** `useViewSettingsEditor` owns a draft
that drives the query at once, writes it 400 ms after the last change, and
reverts with a toast on failure. It never re-syncs from the server while a save
is pending, so a refetch cannot overwrite what is being typed. The List's
`pendingColumns` folded into it.

**Who may write.** `canPersistView` mirrors the API: a personal view is its
owner's, a shared view is any member's. Anyone else keeps a draft and is offered
"Save as my view", which creates a personal view with the draft and opens it at
`?view=<id>`. The active view is `?view=<id>`, else the type's default, else
the first.

**One ordering in SQL for both kinds.** Sorting by a custom field — or by
anything, when tasks and tickets must interleave — goes through
`order-compiler.ts` and `work-item-order.repository.ts`: Prisma computes two id
allowlists with the same `where` it always used, one raw query orders them
(`NULLS LAST` both ways, `position, id` as the tail), and the service hydrates
in that order. The default read is untouched. The group key leads the ordering
so a group never splits across a page.

**Tickets answer what they can.** A filter on a title, assignee, section, due
date, created, updated or completion (`resolvedAt`) applies to tickets; one on a
custom field, a task status or priority, a start date or an estimate excludes
them — except `IS_EMPTY`, which every ticket satisfies for a field it does not
hold. On a custom-field sort every ticket's key is `NULL`, so they land after
the valued tasks.

**Relative dates.** `@today`, `@startOfWeek`, `@endOfWeek`, `@startOfNextWeek`
and `@endOfNextWeek` are resolved on the server at query time (Monday-start,
UTC midnight), so "Due this week" saved on Wednesday is still this week next
Monday. Date filters gained `GREATER_THAN_OR_EQUAL` and `LESS_THAN_OR_EQUAL`
so a week is two inclusive bounds rather than two guesses.

**Manual order** holds only with no sort and the section grouping. Otherwise
the drag handles go, and dragging _between_ groups means "give it this value"
— a status, an assignee, a select option — through the same mutation a cell
edit uses. Grouping is client-side over the page (`group-rows.ts`), which the
API already ordered by the group key: every value the vocabulary offers is
drawn, empty or not, and a value the vocabulary does not know (a ticket's
status under a task-status grouping) gets a heading of its own.

**Options** holds what used to be the Fields button — the List's columns and
their order — plus row density and "Show completed tasks"; on the Board it
holds the card fields, drawn as label/value lines under a card's meta row.

## Known limitations

- **Grouping by a date is not built.** The menu lists "Due date" disabled with
  the reason on hover.
- **Formulas are not filterable or sortable** — they are worked out on read.
  See [ADR 0015](../decisions/0015-formula-fields-computed-on-read.md).
- **Weeks start on Monday at UTC midnight**, not on the reader's locale; a
  documented placeholder.
- **A multi-select sorts by its first stored option**, not the lowest-positioned
  one held.
- **Calendar, Timeline and Dashboard** exist in `ProjectViewType` and nowhere
  else. They are deliberately not half-built.
