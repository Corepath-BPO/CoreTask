# The action catalogue

References 04–06 show the `Do this…` panel: a header and subtitle, a search box,
tabs for `Actions` and `External actions`, then grouped rows with icons. Seven
groups: Move task, Change status, Change task field to…, Change custom field
to…, Create new, Convert task to…, Add to task.

This document maps each group onto what CoreTask can actually run.

The executable set is `AUTOMATION_ACTIONS` in
`packages/contracts/src/automation.ts` — thirty actions. Anything not in that
list is not something the engine performs, whatever a catalogue shows.
`PLANNED_ACTIONS`, the contract-only list, is empty: the last two entries in it,
`CREATE_CHECKLIST` and `ASSIGN_TEAM`, now run.

## The convention: disabled with a reason, never hidden

An entry CoreTask cannot perform is rendered greyed out with an explanation. It
is not filtered out of the list.

The reason is what absence communicates. A catalogue missing "Convert to
project" reads as _never considered_ — the person concludes the product does not
think in those terms and stops looking. The same entry greyed, with its reason,
reads as a decision, which is the truth and saves them searching for it a
second time somewhere else.

The convention has a second half that matters more: an entry shown as available
must be one the engine will actually run. Publishing validates every action
subtype against `AUTOMATION_ACTIONS`, and the runner's `default` case fails
loudly rather than reporting success for something that did not happen. A button
that appears to work and silently does nothing is worse than one that is
visibly unavailable.

### Where it is decided

`actionCatalogue` in `api/src/modules/automations/builder/automation-catalogue.ts`
builds the list the metadata endpoint returns. Each row's `available` is read
off `AUTOMATION_ACTIONS` (`runnerCanPerform`) — never written by hand — so a row
cannot claim to work by being written optimistically, and nothing can be offered
there and refused at publish. A row that cannot run carries a `reason`: its
own where one is written, `AI_UNAVAILABLE_REASON` for the AI steps when no model
is configured, and a generic "not an action the engine can run yet" otherwise.

Rows are grouped by `ACTION_CATEGORY`, which are the references' seven groups
plus `Use AI`, `Wait`, and `Send to another tool` (the External tab). Custom
fields are generated in place, one "Change `Field` to…" row per settable field,
carrying `fieldId` and `fieldName`.

Each row also says what it acts on (`subjects`): a ticket rule is offered only
the rows that name tickets.

## Group by group

Legend: **runs** — implemented and executable. **disabled** — shown greyed, with
the reason given. **absent** — not in the catalogue.

### Move task

| Entry                        | Action                | State |
| ---------------------------- | --------------------- | ----- |
| Move to a section…           | `MOVE_TO_SECTION`     | runs  |
| Move to another project…     | `MOVE_TO_PROJECT`     | runs  |
| Remove task from the project | `REMOVE_FROM_PROJECT` | runs  |

`MOVE_TO_SECTION` re-checks at execution time that the section is still in the
rule's own project, and fails the action if it is not — a rule authored months
ago may name a section that has since been deleted, and moving a task into
another project's section would be a tenancy hole rather than a mistake.

`MOVE_TO_PROJECT` takes a `projectId` and an optional `targetSectionId`, under
its own key so nothing that reads `sectionId` as "a section of this project"
ever sees it. `mode: 'ADD'` adds the task to the other project and keeps it here
too (multi-homing); the default moves it. A moved task:

- **Section** — the chosen one, or the project's first; a project with no
  sections takes the task sectionless.
- **Position** — appended to the end of the new column.
- **Status** — kept when the new project's status set holds the definition;
  otherwise remapped to the same-named status there, then the nearest by
  category, then the set's default. A task carrying only the legacy enum is left
  alone.
- **Custom field values** — kept. Fields are the workspace's; one the new project
  does not show is simply not shown.
- **Subtasks** in the task's project go with it; subtasks that belong to no
  project stay as they are.

Validation refuses the rule's own project, an archived project, a project from
another workspace, and a section that is not in the chosen project. At run time
the same is re-checked and the action fails rather than reaching. The follow-up
`TASK_MOVED_TO_SECTION` event is raised in the _new_ project, so the rules there
see the task arrive, and the realtime relay is sent to both boards.

`REMOVE_FROM_PROJECT` takes the task out of the project but keeps its assignee,
so it stays in that person's My Tasks.

### Change status

| Entry                        | Action                | State |
| ---------------------------- | --------------------- | ----- |
| Change the status            | `UPDATE_STATUS`       | runs  |
| Change completion status to… | `SET_COMPLETION`      | runs  |
| Set ticket status to…        | `SET_TICKET_STATUS`   | runs  |
| Set ticket priority to…      | `SET_TICKET_PRIORITY` | runs  |
| Draft an update with AI…     | `AI_DRAFT_UPDATE`     | runs  |

Setting the status to `DONE` also stamps `completedAt`. Completion is a fact
about the task rather than a second action somebody has to remember to add.
`SET_COMPLETION` moves the task to the project's Done status, or back to its
first open one.

`UPDATE_STATUS` accepts either `statusDefinitionId` or the legacy `status`
enum, because the status-definition migration is deliberately incomplete — see
[the project view migration](../database/project-view-migration.md).

The two ticket rows are offered to ticket rules only. "Draft an update with
AI…" is described under [AI entries](#ai-entries).

### Change task field to…

| Field       | Action                                | State |
| ----------- | ------------------------------------- | ----- |
| Assignee    | `ASSIGN_USER` / `UNASSIGN_USER`       | runs  |
| Team        | `ASSIGN_TEAM`                         | runs  |
| Due date    | `SET_DUE_DATE` / `CLEAR_DUE_DATE`     | runs  |
| Start date  | `SET_START_DATE` / `CLEAR_START_DATE` | runs  |
| Priority    | `UPDATE_PRIORITY`                     | runs  |
| Estimate    | `SET_ESTIMATE`                        | runs  |
| Name        | `SET_TASK_NAME`                       | runs  |
| Description | `SET_TASK_DESCRIPTION`                | runs  |

`SET_DUE_DATE` and `SET_START_DATE` take `daysFromNow`, not a date. A fixed date
written into a rule is stale the week after; "due in three days" stays
meaningful for as long as the rule exists.

`ASSIGN_USER` re-checks workspace membership when it runs, and fails with "That
person is no longer in this workspace" rather than writing an assignee id that
no longer resolves.

`ASSIGN_TEAM` writes the task's `teamId` — the team responsible for it, beside
the assignee. Its configuration is either `{ teamId }` or `{ clear: true }`,
kept apart so that a step nobody has answered yet is told from one that
deliberately clears the team. Publishing refuses a team from another workspace,
and the runner re-checks the team when it runs, failing with "That team is no
longer in this workspace" rather than writing a dangling id. The change is told
in the task's story ("set the team to Maintenance") and raises `TASK_UPDATED`,
so a "task is updated" rule that changes the team is warned about at publish
as one that will set itself off, and its chain is capped like any other — see
[loop protection](./automation-loop-protection.md).

The task's team is also a field in the task panel, offered once the workspace
has a team, and settable through `PATCH /tasks/:id` with `teamId`.

Name and description take text with variables — see
[automation variables](./automation-variables.md).

### Change custom field to…

One generated row per settable field in the project, each naming the field as a
token, all running `SET_CUSTOM_FIELD`.

The action resolves the field **through the project association**
(`projects: { some: { projectId } }`), so a rule may only write a field its own
project actually uses even though the definition is workspace-scoped. The value
is routed to the column matching the field's type by `customFieldValue`.

### Create new

| Entry             | Action           | State    |
| ----------------- | ---------------- | -------- |
| Create a task…    | `CREATE_TASK`    | runs     |
| Create subtasks…  | `CREATE_SUBTASK` | runs     |
| Create approvals… | —                | disabled |

`CREATE_TASK` makes a task in this project, with a name that can use variables,
a section, an assignee and a due date. It is also what a schedule with no tasks
runs.

`CREATE_SUBTASK` inherits the parent's project and section and is authored by
whoever caused the trigger, falling back to the task's creator. Each row may
name an assignee and a due date of its own: a fixed calendar date, or a number
of days after the rule runs (`subtaskEntries` in `@coretask/contracts` is the
one reading of the row). Assignees are re-checked at run time as the assign
action's is; a row whose person has left is created unassigned and the
execution log says so, rather than the step losing every row.

"Create approvals…" is disabled with its reason: create a task, then set its
type to Approval.

### Convert task to…

| Entry                   | Action          | State    |
| ----------------------- | --------------- | -------- |
| Set task type to        | `SET_TASK_TYPE` | runs     |
| Convert task to project | —               | disabled |

`SET_TASK_TYPE` converts between a task, a milestone and an approval; an
approval starts pending. Convert-to-project is disabled with its reason — a
project is not a heavier task in this data model, so there is nothing to
convert to.

### Add to task

| Entry                       | Action                     | State  |
| --------------------------- | -------------------------- | ------ |
| Add comment                 | `ADD_COMMENT`              | runs   |
| Add or remove collaborators | `ADD_REMOVE_COLLABORATORS` | runs   |
| Send a notification         | `SEND_IN_APP_NOTIFICATION` | runs   |
| Checklist…                  | `CREATE_CHECKLIST`         | runs   |
| Attachment                  | —                          | absent |
| Tag                         | —                          | absent |

`ADD_COMMENT` is authored by whoever caused the trigger, falling back to the
task's creator: a comment needs an author and a rule is not a person. An empty
body fails the action rather than posting a blank comment.

`SEND_IN_APP_NOTIFICATION` targets a user, defaulting to the assignee, and fails
with "Nobody to notify" when there is neither a configured recipient nor an
assignee.

`CREATE_CHECKLIST` adds a named checklist to the task, its items unticked. The
configuration is `{ name, items }`: the name is text with variables, as a
comment's body is; the items are the step's own lines, which the builder edits
one per line. `checklistOf` in `@coretask/contracts` is the one reading of it —
the runner, the validator and the builder's card all use it — so blank lines are
dropped and both the item count (`MAX_CHECKLIST_ITEMS`, 50) and the text lengths
are capped the same way everywhere. Publishing refuses a step with no name or no
items. At run time a name that renders empty, or a task that already holds
`MAX_CHECKLISTS_PER_TASK` (20) checklists, fails the step with a message in the
execution log rather than writing anything. A rule that fires twice on a task
adds two checklists: a rule firing twice is a rule configured to.

Checklists are their own rows (`task_checklists`, `task_checklist_items`), and
the same lists are edited by people in the task panel through
`/tasks/:taskId/checklists` — lighter than subtasks: an item is a line and a
tick, with who ticked it and when.

## External actions

`SEND_WEBHOOK` and `SEND_EMAIL` are the External tab.

A webhook step names a destination — `endpointId` (a webhook endpoint registered
under Integrations, signed with its secret) or `url` (an ad-hoc address, sent
unsigned) — and optional `extraFields`, key/value pairs merged into the payload
as `data.extra`. No secret lives in a rule: every member can read a rule.

The runner does not send anything. It re-checks the endpoint (present, enabled)
or the URL's syntax, then returns a `RuleWebhookRequest` on the action outcome,
and `AutomationProcessor` queues it on the webhook queue once the run is over —
the same arrangement as the events a rule raises. The worker's
`WebhookDeliveryService.ruleSend` builds an `automation.webhook` payload
(`data: { task, rule, trigger, extra }`), stores a delivery row carrying the
`ruleId`, and delivers it with the usual retries. Whether an ad-hoc URL is one
CoreTask may call (no private addresses unless `WEBHOOK_ALLOW_PRIVATE_URLS`) is
decided at publish time by the validator and again at delivery time.

An email step writes to people on the task — the assignee, the collaborators,
the creator (`AutomationEmailRecipient`), each a member of the workspace, at
most `MAX_EMAIL_RECIPIENTS` — never a typed address, since a rule anyone can
edit must not be a way to send mail to anyone at all. Variables fill in the
words, and the mail links to the task. Like a webhook, it is sent after the run.

## AI entries

`AI_ACTION` ("Use AI…") and the condition field `ai.check` ("Create conditional
check with AI") run against Anthropic's Messages API through
`api/src/integrations/ai/`. Both are available exactly when
`ANTHROPIC_API_KEY` is set — the catalogue, the metadata's `capabilities.ai`
and the validator all read `AppConfigService.ai.enabled` — and greyed with
`AI_UNAVAILABLE_REASON` otherwise. There is still no stand-in model.

`AutomationAiService` turns a step into one tool-use request. "Use AI…" is
offered one tool per ticked permission, each choice an enum of this project's
ids; the calls that come back are mapped to ordinary actions (`ASSIGN_USER`,
`UPDATE_PRIORITY`, `SET_CUSTOM_FIELD`…) and run by `runAction`, at most
`AI_MAX_CHANGES` and one of each. The AI check forces an `answer` tool with
`holds` and `reason`. `plan` is asynchronous so that only reached checks are
asked. "Let AI decide the number of subtasks" forces a `choose` tool that
answers with row numbers of the step's own list, so the model can leave a
subtask out but never word one.

"Draft an update with AI…" (`AI_DRAFT_UPDATE`) forces a `draft` tool over a
plain-text card of the project — its counts, what was finished in the last
seven days, what is overdue and due next, and the last update. The answer is
stored as the project's one `ProjectStatusDraft` (a newer one replaces it) and
the project's owner, else the last poster, else the rule's author is told; it
is never posted by the rule. It runs in task rules and in a schedule with no
tasks, where it is the one action besides "Create a task".

## The Wait step

"Wait…" sits in the catalogue as its own group but is not an action: it is a
step the runner stops at, and the clock resumes what follows it minutes, hours
or days later, judged on the task as it is by then.

## Not yet in the catalogue

- Adding an attachment or a tag to a task.
- Creating approvals as their own step, and converting a task to a project —
  both shown disabled, with the reasons above.

## Related

- [The automation engine](./automation-engine.md) — how an action executes
- [Loop protection](./automation-loop-protection.md) — what stops a rule
  feeding itself
- [Automation variables](./automation-variables.md) — text with variables
- [The rule builder rebuild](./asana-parity-rule-builder.md)
