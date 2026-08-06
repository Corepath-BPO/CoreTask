# One dataset, two views

## What it looked like before

Every layer had two of everything.

| Layer          | Board                                  | List                                            |
| -------------- | -------------------------------------- | ----------------------------------------------- |
| Endpoint       | `GET /workspaces/:ws/tasks?projectId=` | `POST /workspaces/:ws/projects/:id/tasks/query` |
| Query key      | `tasks.board(ws, projectId)`           | `projectViews.tasks(ws, projectId)`             |
| Backend module | `TasksModule`                          | `ProjectViewsModule`                            |
| Create         | `TaskComposer` → `useCreateTask`       | _nothing_                                       |
| Move           | `useMoveTask`                          | `useMoveTaskToSection`                          |

Two consequences followed directly.

**Only tasks existed.** Both queries read the `tasks` table, so a ticket filed
against a project appeared in neither view. Tickets had no `sectionId` and no
`position` — the schema could not express "this ticket is in that column" at all.

**Invalidation was one-directional.** `invalidateTasks()` invalidated `tasks.*`
and `projects.*`, never `projectViews.*`. A List edit refreshed the Board; a
Board create left the List showing the previous answer. Which is exactly the
symptom this work started from.

## What it looks like now

```
                    GET .../projects/:id/work-items
                                 │
                    ProjectWorkItemService
                       ├── tasks  ─┐
                       └── tickets ┘  merged, one ordering
                                 │
                    queryKeys.workItems.all(ws, projectId)
                          ┌──────┴──────┐
                        List           Board
```

Both views call `useProjectWorkItems`. Both write through
`useCreateProjectWorkItem`, `useUpdateProjectWorkItem` and
`useMoveProjectWorkItem`. There is no `createFromList` / `createFromBoard` pair,
at any layer — the endpoint describes what happens to the project, not which
screen asked.

## The transitional seam

The List's cells were written against `Task` and there are a dozen of them.
`toWorkItemRow` converts a `ProjectWorkItem` into that shape at the boundary
rather than rewriting every cell in the same change that introduced tickets to
the grid.

It is a seam, not a destination:

- the original item is carried alongside as `row.workItem`, so a cell that needs
  the truth asks for it rather than inferring it from a `Task` a ticket is only
  borrowing;
- `isTicketRow(row)` is how the status and priority cells choose a vocabulary.
  A ticket's statuses are OPEN, TRIAGED, RESOLVED, CLOSED — offering a task's
  list would present choices the API refuses and render a badge with no colour
  for the current value.

`toWorkItemUpdate` does the same in the other direction: the cells emit
`{ status, priority, assigneeId }` and the endpoint takes
`{ statusId, priorityId, assigneeIds }`. Until it existed, every inline edit
went to `PATCH /tasks/:id` — a 404 for any ticket row, so editing a ticket in
the grid quietly did nothing and the cell reverted.

Both live in `web/src/features/work-items/lib/`. Deleting them means moving the
cells onto `ProjectWorkItem` directly, which is a contained change once nothing
else is moving.

## What each view still owns

Sharing the data does not mean the views are the same screen.

**List** — spreadsheet editing, custom-field columns, column resize/reorder/pin,
expandable subtasks, per-section quick add, section cards.

**Board** — columns, drag between them, card layout, WIP at a glance.

Both support create, inline edit, assign, status, priority, due date, open
details, and the per-section automation popover. A capability present in one and
missing from the other is a bug, not a design.

## See also

- [Project work items](./project-work-items.md)
- [Keeping List and Board in step](./list-board-synchronization.md)
