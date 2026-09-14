# Loop protection

What stops an automation rule from setting off an automation rule for ever.

This document describes `AutomationRunnerService` as it is written today, not
what the brief asks for. Where the two differ, the difference is listed under
[Not yet implemented](#not-yet-implemented).

## The four mechanisms that exist

Each catches something the others miss, which is why there are four rather than
one good one.

### 1. Correlation id

Every execution descended from one original user action carries the same
`correlationId`. `AutomationEventPublisher` generates one when the event has
none — a fresh id means a user action — and passes an inherited one through
unchanged, which is what marks an event as a continuation rather than a
beginning.

It is written to `AutomationExecution.correlationId` and indexed
(`@@index([correlationId])`), so the whole chain is one query.

It prevents nothing. Its job is diagnosis: a loop with a correlation id is
traceable end to end, and a loop without one is a pile of unrelated-looking
executions that somebody has to correlate by timestamp and guesswork.

### 2. Depth limit

```ts
if (event.depth >= MAX_AUTOMATION_DEPTH) { … }
```

`MAX_AUTOMATION_DEPTH` is **5**, in `@coretask/contracts`. The check is the
first thing `handle` does — before rules are loaded, before anything is read —
so a runaway chain costs one comparison per hop rather than a query.

Five rather than one, because rules legitimately cascade: one moves a task,
another reacts to the move. A limit of one would break real workflows. Beyond a
handful of hops it is almost always a cycle, and the cost of guessing wrong is a
queue consuming itself.

Hitting the limit writes a `SKIPPED` execution with the reason "Depth limit
reached — this looks like a loop." A silent halt would be indistinguishable
from a rule that never matched.

### 3. `BLOCK_SELF_RETRIGGER`

```ts
if (BLOCK_SELF_RETRIGGER && event.causedByRuleId === rule.id) {
  skip;
}
```

A constant, `true`, in `@coretask/contracts` rather than a setting. A rule never
reacts to its own write.

This is the commonest loop by far — a rule that sets a status while listening
for status changes — and blocking it removes the entire class in one comparison.
It is a constant because the case for turning it off has never been made: a rule
that wants to re-run on its own output is asking for an unbounded loop with
extra steps.

### 4. `allowChaining`

A per-rule boolean column, added by `20260807120000_automation_allow_chaining`,
defaulting to `true`.

```ts
if (!rule.allowChaining && event.depth > 0) {
  skip;
}
```

`depth > 0` is exactly the condition "something else in this chain caused this
event", so it is the whole test.

This is not loop protection and should not be read as such. The depth limit
already stops a runaway. This is somebody saying _this rule runs when a person
does it_ — an intent no amount of automatic protection can express, and one that
was previously unexpressible. It defaults to `true` so every rule that existed
before the column keeps behaving exactly as it did.

### And a cap on actions

`MAX_ACTIONS_PER_EXECUTION` is **25**, and it is enforced:

```ts
const actions = plan.actions.slice(0, MAX_ACTIONS_PER_EXECUTION);
```

It is a backstop against a single runaway rule rather than against a cycle —
one rule with two hundred actions never loops and is still a problem.

**It truncates silently.** The 26th action is dropped: no log line, no warning,
and the execution completes as `COMPLETED` because every action it ran
succeeded. A rule that does less than it says it does, reporting success, is
the failure mode this codebase is otherwise careful to avoid. It should either
refuse at publish time or record a truncation reason on the execution.

## How a chain continues

`AutomationRunnerService.updateTask` writes the task and works out which events
the write amounts to — the same ones `TasksService` and `ProjectWorkItemService`
raise when a person makes that change. A section move is
`TASK_MOVED_TO_SECTION`; a status change is `TASK_UPDATED` and
`TASK_STATUS_CHANGED`, with `TASK_COMPLETED` when it lands on done; and so on.
`CREATE_SUBTASK` raises `TASK_CREATED` per subtask and `SET_CUSTOM_FIELD` raises
`CUSTOM_FIELD_CHANGED`. A write that changed nothing raises nothing: assigning
the person already assigned is not an assignment.

Each event is built by `follow`, which is where the guards above get their
inputs:

```ts
correlationId: event.correlationId, // the same thread
depth: event.depth + 1,             // one hop deeper
causedByRuleId: rule.id,            // which rule did it
actorId: event.actorId,             // who set it all going
```

The runner does not publish them. It has no queue, deliberately — it must never
wait on Redis while holding a database connection mid-execution — so `handle`
returns them alongside its counts and `AutomationProcessor` publishes them
through `AutomationEventPublisher` once the run is over. A run that fails
part-way has published nothing rather than half a chain.

Rules on the same event cannot see each other's writes. The task is read once,
before the first rule runs, and every rule's conditions are judged against that
copy; an earlier rule's change reaches a later rule only as a new event at
`depth + 1`, where everything above applies. Before this, four "when completed
in this column, move to the next" rules walked a task through every column
inside one execution at depth zero — a cascade none of the guards could see,
because as far as they were concerned nothing had happened yet.

So, today:

| Mechanism              | Reachable?                                    |
| ---------------------- | --------------------------------------------- |
| Correlation id         | yes — inherited by every hop                  |
| Depth limit            | yes — every hop is one deeper                 |
| `BLOCK_SELF_RETRIGGER` | yes — every hop names the rule that caused it |
| `allowChaining`        | yes — every hop has `depth > 0`               |
| Action cap             | yes                                           |
| Same-event snapshot    | yes — a sibling rule's write is not an input  |

This is what makes rules composable. "When the field changes, move it" and
"when it arrives, add the checklist" are two rules somebody writes separately
and expects to work together, and before the cascade existed the second ran
only when the task was dragged by hand. The price is that the guards are now
load-bearing: a rule cannot trigger another rule for ever, but it can trigger
one for five hops, and `MAX_AUTOMATION_DEPTH` is the number that says so.

## Defence in depth against malformed data

Two limits exist for a different failure: not a cycle between rules, but a cycle
inside one rule's stored shape.

- `AutomationRunnerService.plan` caps its tree walk at depth 50. A cycle is
  refused at validation, but the runner reads rows that may have been written by
  an older client, and a loop there would hang the worker rather than produce a
  wrong answer.
- `layoutGraph` caps at 100 for the same reason on the drawing side.
- `detectCycles` in `@coretask/validation` refuses a graph where a step is its
  own ancestor. The builder cannot draw one; the API accepts a graph from
  anywhere.

## The publish-time warning

`AutomationGraphValidatorService.checkLoopRisk` matches a rule's trigger against
the actions that would re-fire it — `TASK_STATUS_CHANGED` against
`UPDATE_STATUS`, and so on — and emits a **warning**, not an error.

Warned rather than refused, because "when the status changes, set the status" is
occasionally what somebody means: normalising a status, or setting a related
field. Refusing outright would block a legitimate rule to prevent a survivable
one. Warnings do not block publishing; only errors do.

## Concurrency

`AutomationProcessor` runs at concurrency **2**. Automation is not
latency-sensitive — a second's delay goes unnoticed where a lost update does not
— and two rules acting on the same task at once produce a last-write-wins race
that is invisible in the logs.

Two rather than one narrows the window. It does not close it.

## Not yet implemented

The brief asks for these. None of them exists.

**Idempotency keys.** Nothing deduplicates an event. This matters more than it
looks: `AutomationEventPublisher` enqueues with `attempts: 3` and exponential
backoff, so a job that throws after performing two of a rule's four actions is
retried from the beginning and performs those two again. There is no key by
which the runner could recognise work it has already done.

**Per-rule execution locks.** Two events for the same task arriving together can
interleave. There is no advisory lock, no row lock, and no serialisation key on
the queue job. Concurrency 2 is the only mitigation.

**A cap on actions across a chain.** `MAX_ACTIONS_PER_EXECUTION` bounds one
execution. Nothing bounds the total work done by one correlation id, so five
rules of twenty-five actions each is 125 writes attributed to one click, within
every limit.

**A truncation signal.** The action cap should be visible when it bites.

## Related

- [The automation engine](./automation-engine.md) — execution, outcomes, accountability
- [ADR 0011 — automation loop prevention](../decisions/0011-automation-loop-prevention.md)
- [The REST surface](../api/automation-rules.md)
