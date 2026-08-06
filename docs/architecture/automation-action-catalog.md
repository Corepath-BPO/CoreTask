# The action catalogue

References 04–06 show the `Do this…` panel: a header and subtitle, a search box,
tabs for `Actions` and `External actions`, then grouped rows with icons. Seven
groups: Move task, Change status, Change task field to…, Change custom field
to…, Create new, Convert task to…, Add to task.

This document maps each group onto what CoreTask can actually run.

The executable set is `AUTOMATION_ACTIONS` in
`packages/contracts/src/automation.ts`. Eleven actions. Anything not in that
list is not something the engine performs, whatever a catalogue shows.

## The convention: disabled with a reason, never hidden

An entry CoreTask cannot perform is rendered greyed out with an explanation. It
is not filtered out of the list.

The reason is what absence communicates. A catalogue missing "Convert to
project" reads as _never considered_ — the person concludes the product does not
think in those terms and stops looking. The same entry greyed, saying "not
available yet", reads as _not yet_, which is the truth and saves them searching
for it a second time somewhere else.

`AutomationMetadataService` states the same rule for triggers:

> Listed rather than filtered: an unavailable trigger shown disabled says "not
> yet", and one simply missing says "never considered".

The convention has a second half that matters more: an entry shown as available
must be one the engine will actually run. Publishing validates every action
subtype against `AUTOMATION_ACTIONS`, and the runner's `default` case fails
loudly rather than reporting success for something that did not happen. A button
that appears to work and silently does nothing is worse than one that is
visibly unavailable.

### The convention is not implemented in the API

`AutomationMetadataService.actions()` maps `AUTOMATION_ACTIONS` and marks every
entry `available: true`. `PLANNED_ACTIONS` is never read, so the metadata
endpoint returns **only** the eleven executable actions — the unavailable ones
are absent, not disabled.

Any client following the convention today has to import `PLANNED_ACTIONS` from
the contracts package and merge the two lists itself. The endpoint is the wrong
place for that split to be missing, since it is the thing that knows what the
engine can do.

The same method hard-codes `available: true` for every trigger, including
`TICKET_CREATED` and `TICKET_STATUS_CHANGED`. Those two are now published by
`ProjectWorkItemService`, so the flag happens to be correct — but it is correct
by coincidence, not because anything checks.

## Group by group

Legend: **runs** — implemented and executable today. **planned** — a contract
entry in `PLANNED_ACTIONS`, no implementation. **absent** — not modelled at all.

### Move task

| Entry              | Action            | State   |
| ------------------ | ----------------- | ------- |
| to a section       | `MOVE_TO_SECTION` | runs    |
| to another project | `MOVE_PROJECT`    | planned |

`MOVE_TO_SECTION` re-checks at execution time that the section is still in the
rule's own project, and fails the action if it is not — a rule authored months
ago may name a section that has since been deleted, and moving a task into
another project's section would be a tenancy hole rather than a mistake.

`MOVE_PROJECT` is unimplemented and non-trivial: a task carries section
membership, custom field values and view columns that all belong to its current
project, and none of them survive the move without a decision about what happens
to them.

### Change status

| Entry          | Action          | State |
| -------------- | --------------- | ----- |
| set the status | `UPDATE_STATUS` | runs  |

Setting the status to `DONE` also stamps `completedAt`. Completion is a fact
about the task rather than a second action somebody has to remember to add.

The action config accepts either `statusDefinitionId` or the legacy `status`
enum, because the status-definition migration is deliberately incomplete — see
[the project view migration](../database/project-view-migration.md).

### Change task field to…

References show one entry per field, each naming the field as a pill. CoreTask
covers four of the fields a task has:

| Field         | Action                            | State   |
| ------------- | --------------------------------- | ------- |
| Assignee      | `ASSIGN_USER` / `UNASSIGN_USER`   | runs    |
| Priority      | `UPDATE_PRIORITY`                 | runs    |
| Due date      | `SET_DUE_DATE` / `CLEAR_DUE_DATE` | runs    |
| Assigned team | `ASSIGN_TEAM`                     | planned |
| Title         | —                                 | absent  |
| Description   | —                                 | absent  |
| Start date    | —                                 | absent  |
| Collaborators | —                                 | absent  |

`SET_DUE_DATE` takes `daysFromNow`, not a date. A fixed date written into a rule
is stale the week after; "due in three days" stays meaningful for as long as the
rule exists.

`ASSIGN_USER` re-checks workspace membership when it runs, and fails with "That
person is no longer in this workspace" rather than writing an assignee id that
no longer resolves.

Title and description are absent rather than planned. Both would need the
variable representation described in
[automation variables](./automation-variables.md) to be worth having — an action
that can only set a task's title to a constant is an action that renames every
task it touches to the same thing.

### Change custom field to…

| Entry              | Action             | State |
| ------------------ | ------------------ | ----- |
| set a custom field | `SET_CUSTOM_FIELD` | runs  |

The references generate one entry per field in the project, each naming the
field as a pill. `AutomationMetadataService` returns `customFields` for the
project — id, name and type — which is what such a list would be generated from.
Nothing generates it yet; the builder offers one generic "Set a custom field"
entry with the field chosen inside the inspector.

The action resolves the field **through the project association**
(`projects: { some: { projectId } }`), so a rule may only write a field its own
project actually uses even though the definition is workspace-scoped. The value
is routed to the column matching the field's type by `customFieldValue`.

### Create new

| Entry     | Action             | State   |
| --------- | ------------------ | ------- |
| Subtask   | `CREATE_SUBTASK`   | runs    |
| Checklist | `CREATE_CHECKLIST` | planned |
| Task      | —                  | absent  |
| Project   | —                  | absent  |
| Ticket    | —                  | absent  |

`CREATE_SUBTASK` inherits the parent's project and section and is authored by
whoever caused the trigger, falling back to the task's creator. It takes a
literal title, with the same limitation as the absent title action above.

### Convert task to…

**Nothing in this group runs, and nothing is planned.** CoreTask has no
conversion between work item types available to automation.

The anchor document lists convert-to-project among the things deliberately
excluded, and it is not an oversight: a project is not a heavier task in this
data model. `ProjectWorkItem` does distinguish tasks from tickets — see
[project work items](./project-work-items.md) — so a task-to-ticket conversion
is the plausible first member of this group, and it does not exist either.

The whole group renders disabled, per the convention.

### Add to task

| Entry                   | Action                     | State   |
| ----------------------- | -------------------------- | ------- |
| Comment                 | `ADD_COMMENT`              | runs    |
| Notification            | `SEND_IN_APP_NOTIFICATION` | runs    |
| Checklist               | `CREATE_CHECKLIST`         | planned |
| Attachment              | —                          | absent  |
| Follower / collaborator | —                          | absent  |
| Tag                     | —                          | absent  |

`ADD_COMMENT` is authored by whoever caused the trigger, falling back to the
task's creator: a comment needs an author and a rule is not a person. An empty
body fails the action rather than posting a blank comment.

`SEND_IN_APP_NOTIFICATION` is grouped here in the references' shape but is not
really "on the task" — it targets a user, defaulting to the assignee, and fails
with "Nobody to notify" when there is neither a configured recipient nor an
assignee.

## External actions

The tab exists in the references. **No external action is implemented.**
`SEND_EMAIL` and `SEND_WEBHOOK` are in `PLANNED_ACTIONS` and have contract
entries only.

The tab is kept for structural parity and says it will be available later, which
is the same convention applied to a whole surface rather than one row. No fake
integrations, and no tab quietly removed so that nobody asks.

## AI entries

`AI_ACTION` is in `PLANNED_ACTIONS`. The condition catalogue's "Create your own
(AI)" entry is in the references and feature-flagged off. There is no model
behind either, and a fake one is worse than a gap.

## Summary of the eleven that run

| Action                     | Label               | Category            |
| -------------------------- | ------------------- | ------------------- |
| `ASSIGN_USER`              | Assign a person     | Assignment          |
| `UNASSIGN_USER`            | Remove the assignee | Assignment          |
| `MOVE_TO_SECTION`          | Move to a section   | Status and workflow |
| `UPDATE_STATUS`            | Change the status   | Status and workflow |
| `UPDATE_PRIORITY`          | Change the priority | Status and workflow |
| `SET_DUE_DATE`             | Set the due date    | Dates               |
| `CLEAR_DUE_DATE`           | Clear the due date  | Dates               |
| `SET_CUSTOM_FIELD`         | Set a custom field  | Fields              |
| `ADD_COMMENT`              | Add a comment       | Communication       |
| `SEND_IN_APP_NOTIFICATION` | Send a notification | Communication       |
| `CREATE_SUBTASK`           | Create a subtask    | Subtasks            |

Categories come from `AUTOMATION_SELECTOR_CATEGORY` and are how the builder
groups the list today — they are not the seven groups the references show. The
reference grouping is a presentation concern for the new catalogue; the
categories above are what the metadata endpoint currently returns.

## Not yet implemented

- The catalogue's own shape: search box, tabs, grouped rows with icons, custom
  fields generated as individual entries.
- `PLANNED_ACTIONS` in the metadata response, which is what any disabled-with-a-
  reason rendering needs.
- A `reason` field on `AutomationCatalogEntry`. It carries `available` but no
  explanation, so a client can grey a row and cannot say why.
- Every action marked planned or absent above.

## Related

- [The automation engine](./automation-engine.md) — how an action executes
- [Automation variables](./automation-variables.md) — why text-setting actions wait
- [The rule builder rebuild](./asana-parity-rule-builder.md)
