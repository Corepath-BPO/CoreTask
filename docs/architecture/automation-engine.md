# Automation engine

Project workflow rules: when something happens, if certain things hold, do
something. The backend is the source of truth — nothing here is frontend
behaviour.

## Execution path

```
Domain event (task moved, status changed, …)
        │  AutomationEventPublisher.publish()
        ▼
BullMQ queue: coretask.automation
        │  AutomationProcessor (worker, concurrency 2)
        ▼
AutomationRunnerService.handle(event)
        │
        ├─ depth >= 5?            → SKIPPED execution, stop
        ├─ find ACTIVE rules for (project, trigger), oldest first
        ├─ read the task once — the snapshot every rule's conditions see
        └─ for each rule:
             ├─ rule caused this event? → skip that rule
             ├─ trigger config matches?  → else skip
             ├─ every condition holds against the snapshot? → else SKIPPED with a reason
             └─ run each action against the live row, logging every attempt
                ▼
        AutomationExecution + AutomationExecutionLog rows
        ActivityLog entry naming the rule
                │
                ▼
        Events for what the actions changed → AutomationProcessor publishes
        them back onto the queue, one hop deeper, tagged with the rule
```

**Rules never run inside the request that triggered them.** A rule with four
actions must not add its latency to the click that caused it, and a failing rule
must not fail the user's own edit. `AutomationEventPublisher` never throws for
the same reason: a queue outage degrades automation, it does not break editing.

**Rules on one event cannot see each other's writes.** The task is read once,
before the first rule runs, and every rule's conditions are judged against that
copy. What a rule's actions change reaches the other rules only as the follow-on
event those actions raise, one hop deeper, where the chaining guards apply.
Without this, four "when completed in this column, move to the next" rules
walked a task through every column inside one execution at depth zero,
invisible to every guard. Actions do share the live row, so a second rule that
applies writes on top of what the first left rather than over it.

## Module layout, and why it is split

Three modules where one would seem simpler:

| Module                   | Depends on                  | Used by                                                                                       |
| ------------------------ | --------------------------- | --------------------------------------------------------------------------------------------- |
| `AutomationEventsModule` | the queue only              | `TasksModule` — anything that changes a task; `WorkerModule`, to announce what a rule changed |
| `AutomationRunnerModule` | Prisma only                 | `WorkerModule`                                                                                |
| `AutomationsModule`      | Projects, workspace members | the API, for rule CRUD                                                                        |

The split is not tidiness. Importing a full domain module into the worker stopped
it booting during the attachments milestone — `TasksService` pulls in
notifications, which pulls in the websocket gateway, which the worker does not
register. The publisher is a leaf so the request path never depends on the
engine; the runner writes through Prisma directly so the worker never depends on
the request path.

## Rule shape

A node tree (`AutomationNode`), not separate Trigger/Condition/Action tables.
Both models cannot coexist without one of them being a lie, and a tree is what a
visual builder edits — branches need a parent and an ordinal, which normalised
tables would have to reinvent.

`AutomationRule.triggerType` is denormalised from the trigger node so matching an
event is one indexed query (`projectId, status, triggerType`) rather than a join
through every rule's nodes.

## Publishing

`DRAFT` is the only status a rule can be created in, whatever the request says.
`publish` is the sole path to `ACTIVE`, and it validates:

- the trigger is one the engine understands
- there is at least one action
- every action is one the engine can run
- every action has the setting it cannot run without — a section to move to,
  somebody to assign, a status, a field, the text of a comment
- a section named in the trigger still exists

Each of these otherwise fails **silently at run time** — a rule with no action
does nothing, one naming a deleted section never matches, and an unrunnable
action would report success for something that never happened. All problems are
returned at once so a builder can show them together.

## The rule library

The same rule is wanted in project after project — "assign the lead when a task
lands in Review" is one rule everywhere, with a different Review. `duplicate`
copies a rule beside itself; the library (`AutomationTemplate`,
`library/automation-templates.service.ts`) is how a rule crosses to another
project.

**A template is a snapshot, not a link.** The graph is copied into a
workspace-scoped row when somebody saves it, and the rule goes on being edited,
paused and archived without touching it. A template that changed under everyone
who had already used it would be a rule nobody wrote. It is stored as JSON in
the shape `POST /automations` accepts rather than as node rows: a template is
never executed, validated in place or edited, only read whole and written into a
new draft, so a second node table would be structure with no query to serve.

**Ids are translated on the way in, by name.** A rule's sections, statuses,
custom fields and options are ids from the project it was saved in. The service
records the names behind them at save time (the `references` column), and
`apply` matches each against the target project: kept when the project has the
same row, matched by name when it does not, otherwise cleared and reported. The
names are recorded rather than looked up later because the source project may
have renamed or deleted them by then — the template is the record of what the
rule meant. Members and priorities are workspace-wide and travel as they are.

**Apply creates a draft, never a live rule.** What could not be matched is left
blank and listed in the response, the builder shows the blanks as unanswered
steps, and `publish` refuses an action missing its setting — which is the only
reason that refusal exists on the structural validator at all. Refusing the
apply instead would make the library useless for exactly the rules it is for.

**Starters are the client's, not the database's.** The library dialog also
offers a fixed list of common rules (`web/src/features/automations/lib/
starter-templates.ts`). A starter names no section, person or field, so nothing
about it belongs to a workspace; choosing one opens the builder with the shape
drawn and the blanks unanswered, and nothing is written until the draft is
saved. The server never sees a starter as such.

## Loop protection

Three independent mechanisms, because each catches what the others miss.

**1. A rule never reacts to its own write.** `BLOCK_SELF_RETRIGGER`, matched on
`event.causedByRuleId`. This is the commonest loop by far — a rule that sets a
status while listening for status changes — and blocking it removes the entire
class.

**2. Depth limit of five** (`MAX_AUTOMATION_DEPTH`). Rules legitimately cascade:
one moves a task, another reacts to the move. A limit of one would break real
workflows. Past a handful of hops it is a cycle, and the cost of guessing wrong
is a queue consuming itself.

**3. Correlation id.** Every execution descended from one original user action
shares it, which makes a loop traceable end to end rather than merely suspected.

Plus `MAX_ACTIONS_PER_EXECUTION` (25) as a backstop on a single runaway rule.

A stopped chain writes a `SKIPPED` execution with a reason. A silent halt would
be indistinguishable from a rule that never matched.

## Subtask roll-up

`TASK_COMPLETED` fires for the task itself, and — the other half of the
trigger's label — for a parent whose last open subtask was just completed. The
request paths never look at siblings; `AutomationRunnerService.subtaskRollup`
works it out from the subtask's own event and raises the same event again for
the parent, on the same correlation id and at the same depth, since a person
finishing the last subtask is still a person doing it. The parent is not marked
complete by this. The event carries `allSubtasksCompleted: true`, and the
"completion status" condition reads that as well as the task's own column.

## Outcomes

| Status             | Meaning                                        |
| ------------------ | ---------------------------------------------- |
| `COMPLETED`        | every action succeeded                         |
| `PARTIALLY_FAILED` | some actions failed; the log says which        |
| `FAILED`           | every action failed                            |
| `SKIPPED`          | conditions did not hold, or a guard stopped it |

`SKIPPED` is deliberately not `FAILED`. A rule that does not apply has not gone
wrong, and a history that conflates the two is useless for diagnosis.

One failing action does not abandon the rest — a rule that assigns someone and
adds a comment should still comment if the assignment fails — and every attempt
is logged with its before and after values.

An unknown condition operator evaluates to **false**, not true. A condition
nobody can evaluate must block the rule rather than wave it through.

## Validation at execution time

Membership and section ownership are re-checked when an action runs, not only
when the rule was written. A rule authored months ago may assign someone who has
since left the workspace, or move a task to a section that has been deleted.

## Accountability

Every run that performs at least one action writes an `ActivityLog` entry naming
the rule. Without it, a task's assignee changes with nothing in its history
explaining why, and the only honest reading is that a colleague did it.

The entry is attributed to whoever caused the trigger — the change is a
consequence of what they did — while the summary says a rule performed it. One
entry per run, not per action: the feed is a summary for people, and per-action
detail already lives in `AutomationExecutionLog` for anyone debugging.

## Known limitations

- **Branches and delays are modelled but not executed.** `AutomationNodeType`
  includes `BRANCH` and `DELAY`; the runner ignores both. Publishing a rule
  containing one will succeed and the node will be skipped.
- **Ticket triggers are declared but not wired.** `TICKET_CREATED` and
  `TICKET_STATUS_CHANGED` are in the contract; `TicketsService` does not publish.
- **Actions listed in `PLANNED_ACTIONS`** (email, webhook, delay, and the rest)
  have contracts only. The builder shows them disabled and the runner refuses
  them loudly rather than reporting success.
- **No per-rule execution lock.** Two events for the same task arriving together
  can interleave. Concurrency is set to 2 to narrow the window, not close it.
