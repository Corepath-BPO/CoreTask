# Project work items

A project owns work. List and Board are two drawings of it.

That sentence is the whole design. Before this change each view owned its own
read query, its own creation path and its own cache key, so "the project" was
whatever the screen you happened to be on had last fetched. The List could not
create anything at all, and a ticket filed anywhere was invisible on both.

## The model

```
Project
├── Sections           ordered columns / groups
├── Work items
│   ├── Ticket         backed by `tickets`
│   ├── Task           backed by `tasks`
│   ├── Milestone      declared, not creatable
│   └── Approval       declared, not creatable
├── Custom fields
├── Automations
└── Views              List, Board
```

`WorkItemType` has four members; `CREATABLE_WORK_ITEM_TYPES` has two. Milestone
and Approval are declared so the picker can show them as coming rather than
absent — "not built yet" and "never considered" look identical when a type is
simply missing — and so adding them later does not change the union. Anything
that can create refuses a type outside the creatable set, in the Zod schema and
again in the service.

## Two tables, one abstraction

Tasks and tickets keep their own tables. They differ in the ways that matter to
whoever filed them:

|               | Task                                                          | Ticket                                                                          |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| identity      | uuid                                                          | workspace-scoped `key`, e.g. `CORE-1042`                                        |
| status        | `StatusDefinition` FK, with a legacy enum still authoritative | own enum                                                                        |
| priority      | definition FK + legacy enum                                   | own enum                                                                        |
| hierarchy     | one level of subtasks                                         | none                                                                            |
| custom fields | yes                                                           | not yet — see [work-item compatibility](../database/work-item-compatibility.md) |
| extras        | estimate                                                      | severity, reporter, resolved/closed timestamps                                  |

A merge is not reversible once values are repointed, and a ticket key is
something people have already quoted in email. So the tables stay, and
`ProjectWorkItemService` fronts a repository per kind:

```
ProjectWorkItemService          decides what happens
├── TaskWorkItemRepository      decides which task columns move
└── TicketWorkItemRepository    decides which ticket columns move
```

The service holds no `if (type === TASK)` beyond choosing a repository. The
moment it starts special-casing one kind, the abstraction has stopped paying for
itself.

## The read model

`ProjectWorkItem` keeps shared fields at the top level and everything
type-specific in a discriminated `details`. That split is what lets the List
render a grid without asking what backs each row, while a ticket keeps its key,
severity and reporter.

Two fields are worth explaining because they look redundant:

- `status` / `priority` are **resolved** — `{ id, name, colorToken }`. A task
  carries a definition, a ticket carries an enum, and both end up in the same
  column of the same grid. Resolving server-side is what lets one cell render
  either.
- `details.rawStatus` / `details.rawPriority` are the **enum**. They are not the
  same thing: for a task with a definition, `status.id` is a uuid — fine for
  display, useless to a control that renders a fixed set of enum badges. Using
  the resolved id in the grid printed `019fce6b-…` where a status should be.

## One position space per section

Tasks and tickets share a section's `position`. A board column is one sequence,
not two interleaved ones, so the sibling list used for placement queries both
tables. Computing it from tasks alone lets a ticket land on a position a task
already holds, and the column order becomes a coin toss between requests.

Ordering falls back to `id` on a tie, which is uuid v7 and therefore
time-ordered — without it two items created in the same millisecond could swap
places between requests.

## What a section's default status does, and does not

`Section.defaultStatusId` applies to a **task** moved into that section, and to
nothing else. It is null by default: a section is a workflow column and a status
is task state, and coupling them silently is how "drag a card" becomes an
unexplained status change.

It is deliberately **not** applied to a ticket. It points at a
`StatusDefinition`, which is a task status; a ticket's "resolved" carries a
resolution somebody is accountable for. Mapping one onto the other by position
in a list is guesswork, and the wrong guess silently closes a customer's ticket.

## See also

- [Shared data between the views](./project-views-shared-data.md)
- [Creating work items](./work-item-creation.md)
- [Keeping List and Board in step](./list-board-synchronization.md)
- [API reference](../api/project-work-items.md)
- [Storage compatibility and future migration](../database/work-item-compatibility.md)
