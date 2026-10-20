# Loop protection

What stops an automation rule from setting off an automation rule for ever.

This document describes `AutomationRunnerService` as it is written today, not
what the brief asks for. Where the two differ, the difference is listed under
[Not yet implemented](#not-yet-implemented).

## The mechanisms that exist

Each catches something the others miss, which is why there are several rather
than one good one.

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

### 5. A cap on actions per run

`MAX_ACTIONS_PER_EXECUTION` is **25**. It is a backstop against a single
runaway rule rather than against a cycle — one rule with two hundred actions
never loops and is still a problem.

It is enforced twice, and neither time silently:

- **At publish.** `validateGraphStructure` in `@coretask/validation` counts
  actions along each path from the trigger, starting again after a Wait step
  (what follows a Wait runs later, as a run of its own). The first step past
  the cap is an error on that step: "A rule does at most 25 actions in one run,
  and this is one more." The builder shows it from the same function.
- **At run time,** for a rule that reached the runner some other way — written
  before the check, or a shape the per-path count does not see (a step with
  two children, which only the API can write). `AutomationRunnerService.perform`
  runs the first 25 and writes a log row for every step after them —
  `succeeded: false`, "Not run: a rule does at most 25 actions in one run." —
  and the run ends `PARTIALLY_FAILED` with an error saying how many were cut.
  A rule that does less than it says while reporting success is the failure
  this engine refuses everywhere else.

### 6. A cap on actions per chain

`MAX_ACTIONS_PER_CHAIN` is **100**. The depth limit bounds how deep a chain
goes and the per-run cap how much one run does; neither bounds the total —
five hops of twenty-five actions each is 125 writes from one click, within
both.

A **chain** is everything descended from one event. Every event carries a
`chainId`: `AutomationEventPublisher` sets it to the event's own id when the
event has none (nothing came before it), and `follow` copies it onto every
event a rule's write raises. It is written to `AutomationExecution.chainId`,
indexed, beside `actionsRun` — how many action steps the run performed.

Before running a plan's actions, `perform` sums `actionsRun` over the chain's
other runs. What is left of the 100 — or 25, whichever is lower — is what this
run may do; the steps past it are logged as not run, naming the chain cap. A
run with nothing left at all is `SKIPPED`: "Stopped: … This looks like a
loop."

Why not count by `correlationId`, which already exists? Because a manual run
and a scheduled run give every task in the batch the same correlation id, so
the history reads them as one run. Counted that way, a fifty-task batch would
cut the fiftieth task off for the work done on the other forty-nine. Fifty
tasks are fifty chains.

The sum excludes runs still in progress beside this one (the processor runs
two jobs at once), so it can be short by a run's worth. A backstop against a
runaway does not need to be exact to the action.

### 7. One run per rule per event

`AutomationEventPublisher` enqueues with `attempts: 3` and exponential
backoff, so a job that throws after its first rule acted is retried from the
beginning. Two things stop the retry doing that rule's work again:

- **The queue job is keyed on the event** — `jobId: event-<eventId>` (a
  resumption after a Wait adds `-from-<nodeId>`; BullMQ refuses a `:` in a
  custom id). The same event published twice is one job while BullMQ still
  holds the first: an hour after it completes, a day after it fails.
- **The run is keyed on the rule and the event.** `AutomationExecution` has
  `idempotencyKey` — the event id, plus `/<nodeId>` for a resumption — unique
  per rule. `begin` looks for it before creating a run. Found finished, the
  rule is not run again; found `RUNNING`, a worker died part-way, and the run
  is closed as `FAILED` ("stopped part-way and was not repeated") rather than
  re-run, because which of its steps took effect is not knowable and a comment
  posted twice is the harm this exists to prevent.

Either way the retry hands back what the earlier run asked to have sent. Each
step's log row keeps its `followUps` — the events its write raised, the
webhooks and e-mails it queued — so a job that failed after a rule ran does
not lose the chain that rule started. Those events keep the ids they were
raised with, so publishing them again is the same jobs.

The events the engine raises on a run's behalf — a parent's checklist
completing, a task coming unblocked, a Wait step resuming — get ids derived
from their source (`derivedEventId`, a name-based UUID) rather than random
ones, for the same reason: raised twice, they are the same occurrence.

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
| Per-run action cap     | yes                                           |
| Per-chain action cap   | yes — every hop inherits the `chainId`        |
| One run per event      | yes — every hop has an id of its own          |
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

**Per-rule execution locks.** Two events for the same task arriving together can
interleave. There is no advisory lock, no row lock, and no serialisation key on
the queue job. Concurrency 2 is the only mitigation.

**Resuming an interrupted run.** A run found `RUNNING` on a retry is closed, not
finished: its remaining steps do not run. Finishing it would mean knowing
which of its steps took effect before the worker died, and the log row is
written after the step, so a step that wrote and then died before logging
would run twice.

## Related

- [The automation engine](./automation-engine.md) — execution, outcomes, accountability
- [ADR 0011 — automation loop prevention](../decisions/0011-automation-loop-prevention.md)
- [The REST surface](../api/automation-rules.md)
