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
        ├─ find ACTIVE rules for (project, trigger)
        ├─ rule caused this event? → skip that rule
        ├─ trigger config matches?  → else skip
        ├─ every condition holds?   → else SKIPPED with a reason
        └─ run each action, logging every attempt
                ▼
        AutomationExecution + AutomationExecutionLog rows
        ActivityLog entry naming the rule
```

**Rules never run inside the request that triggered them.** A rule with four
actions must not add its latency to the click that caused it, and a failing rule
must not fail the user's own edit. `AutomationEventPublisher` never throws for
the same reason: a queue outage degrades automation, it does not break editing.

## Module layout, and why it is split

Three modules where one would seem simpler:

| Module | Depends on | Used by |
| --- | --- | --- |
| `AutomationEventsModule` | the queue only | `TasksModule` — anything that changes a task |
| `AutomationRunnerModule` | Prisma only | `WorkerModule` |
| `AutomationsModule` | Projects, workspace members | the API, for rule CRUD |

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
- a section named in the trigger still exists

Each of these otherwise fails **silently at run time** — a rule with no action
does nothing, one naming a deleted section never matches, and an unrunnable
action would report success for something that never happened. All problems are
returned at once so a builder can show them together.

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

## Outcomes

| Status | Meaning |
| --- | --- |
| `COMPLETED` | every action succeeded |
| `PARTIALLY_FAILED` | some actions failed; the log says which |
| `FAILED` | every action failed |
| `SKIPPED` | conditions did not hold, or a guard stopped it |

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
- **Cascades are not re-published.** An action that changes a task does not
  currently emit a follow-on event, so a rule cannot yet trigger another rule.
  The depth and correlation plumbing exists for when it does.
- **Ticket triggers are declared but not wired.** `TICKET_CREATED` and
  `TICKET_STATUS_CHANGED` are in the contract; `TicketsService` does not publish.
- **Actions listed in `PLANNED_ACTIONS`** (email, webhook, delay, and the rest)
  have contracts only. The builder shows them disabled and the runner refuses
  them loudly rather than reporting success.
- **No per-rule execution lock.** Two events for the same task arriving together
  can interleave. Concurrency is set to 2 to narrow the window, not close it.
