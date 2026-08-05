# 0011. Automation loop prevention

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

An automation engine that can change tasks, listening for changes to tasks, can
loop. The two shapes are:

- **Self-trigger.** A rule sets a status while listening for status changes, so
  its own write wakes it again.
- **Mutual.** Rule A moves a task to section 1 on arrival in section 2; rule B
  does the reverse. Neither rule is wrong on its own.

Unbounded, either consumes the queue and then the database. Both are trivially
easy to build by accident, and neither is obvious when writing the second rule.

A single mechanism was tempting — most systems ship one — but each candidate has
a gap:

- blocking self-triggers alone does nothing for mutual loops
- a depth limit alone either breaks legitimate cascades (if shallow) or lets a
  tight self-loop run several times before stopping (if deep)
- a duplicate-event check alone cannot distinguish a loop from a user genuinely
  making the same change twice

## Decision

**Three independent mechanisms**, on the principle that each covers what the
others miss.

1. **A rule never reacts to its own write.** Every event carries
   `causedByRuleId`; a rule matching its own id is skipped. This kills the
   self-trigger class outright rather than bounding it.
2. **Depth limit of five.** Every event carries `depth`, incremented per hop.
   Rules legitimately cascade — one moves a task, another reacts — so one hop
   would break real workflows. Past a handful it is a cycle.
3. **Correlation id.** Every execution descended from one user action shares it,
   so a loop is traceable end to end rather than inferred from timestamps.

Plus `MAX_ACTIONS_PER_EXECUTION` as a backstop on one runaway rule.

A stopped chain writes a `SKIPPED` execution with a reason. Silence would be
indistinguishable from a rule that simply did not match.

## Consequences

Good:

- the common case — someone builds a self-triggering rule — is prevented, not
  merely limited, so it never runs twice
- legitimate two- and three-step cascades still work
- when something is stopped, the history says so and why, and the correlation id
  groups the whole chain

Costs:

- three mechanisms is three things to understand and keep working. The depth
  limit in particular is a number someone will eventually want to raise
- five is a guess. It is generous enough for real workflows and small enough that
  a cycle burns little, but no measurement informed it
- `causedByRuleId` must be threaded through every event a rule causes. The
  plumbing exists; **cascade re-publishing is not yet implemented**, so mechanism
  1 is currently protecting against a case that cannot arise. That is deliberate
  — the guard should predate the capability, not follow it
- no per-rule execution lock. Two events for the same task arriving together can
  interleave; worker concurrency of 2 narrows the window rather than closing it

Rejected: an idempotency key on (rule, entity, event hash). It would suppress
genuine repeat actions — moving a task out of a section and back is a real thing
people do — and the failure mode is a rule that silently stops working.
