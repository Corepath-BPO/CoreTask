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

## The gap that makes most of this dormant

Three of the four mechanisms sit on a path nothing currently reaches.

`AutomationRunnerService.updateTask` writes the task and stops:

```ts
await this.prisma.task.update({ where: { id: taskId }, data });

// Cascades are published by the caller rather than here: the runner has no
// queue, deliberately, so it cannot enqueue work while holding a database
// connection mid-execution.
void ruleId;
void event;
```

No caller publishes them. Nothing in `api/src` ever sets `causedByRuleId` — it
is declared on `AutomationEvent` and read in exactly one place, the
`BLOCK_SELF_RETRIGGER` check — and nothing ever passes a non-zero `depth`.

So, today:

| Mechanism              | Reachable?                               |
| ---------------------- | ---------------------------------------- |
| Correlation id         | yes — set on every execution             |
| Depth limit            | no — `event.depth` is always 0           |
| `BLOCK_SELF_RETRIGGER` | no — `causedByRuleId` is never populated |
| `allowChaining`        | no — its test is `depth > 0`             |
| Action cap             | yes                                      |

This is not a criticism of the design; the plumbing is deliberately in place
ahead of the cascade that needs it, which is the right order to build it in. But
a reader has to know that a rule cannot currently trigger another rule at all,
and therefore that none of these guards has ever fired in production. The
docstring above `updateTask` says it "re-publishes the event, tagged with the
rule". It does not. Trust the body.

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

**Cascade publication**, described above, without which the depth limit, the
self-retrigger block and `allowChaining` are all unreachable.

**A truncation signal.** The action cap should be visible when it bites.

**An attribution fix in `recordSkipped`.** When the depth limit stops a chain,
the skipped execution is recorded against whatever rule `findFirst` returns for
that project and trigger — with no status filter, so it can name a draft or an
archived rule that had nothing to do with the event. A depth-limit skip attached
to the wrong rule is worse than one attached to none, because somebody will go
and read that rule.

## Related

- [The automation engine](./automation-engine.md) — execution, outcomes, accountability
- [ADR 0011 — automation loop prevention](../decisions/0011-automation-loop-prevention.md)
- [The REST surface](../api/automation-rules.md)
