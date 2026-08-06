# Branches

A rule's branches are its ordered alternatives. Three kinds:

| Type           | What it is                                               | Condition group |
| -------------- | -------------------------------------------------------- | --------------- |
| `PRIMARY`      | the first alternative, with the rule's opening condition | required        |
| `OTHERWISE_IF` | a further alternative, with its own condition            | required        |
| `OTHERWISE`    | the fallback, when nothing above matched                 | none            |

These are the values of the `AutomationBranchType` enum, created by
`20260807160000_automation_structured_rules`.

## Status: modelled, not executed

The enum and the `automation_branches` table exist. **Nothing reads or writes
them.** The runner evaluates the legacy `AutomationNode` tree, where a split is
a `BRANCH` node with two arms keyed `match` and `else` (`BranchKey` in
`@coretask/contracts`), and an "otherwise if" has to be built by nesting a
branch inside the previous branch's `else` arm.

Everything below is the model the tables encode. The last section says what
enforces it today, which is less than you would hope.

## Evaluation order

Top to bottom by `position`. **First match wins.** `OTHERWISE` runs only if no
branch above it matched.

```
position 0  PRIMARY       status is Blocked        → notify the lead
position 1  OTHERWISE_IF  priority is Critical     → assign the on-call
position 2  OTHERWISE                              → add a comment
```

A task that is both Blocked and Critical runs branch 0 and nothing else.

### Why first match wins rather than every match

The alternative — run every branch whose condition holds — is representable and
was rejected. Two branches acting on the same task collide: one sets the status
to `IN_PROGRESS`, another sets it to `BLOCKED`, and the result is whichever
wrote last. That is not a race the runner can resolve, because both are correct
according to the rule as written. The person who wrote it gets a task in a state
neither branch asked for, with an execution log showing both actions succeeding.

First-match-wins makes the rule a decision, and a decision has one answer. It
also matches what the word "otherwise" means to the person reading the canvas,
which is the only definition that matters at the point somebody is trying to
understand why their task did not move.

The cost is real: a rule where two things genuinely should both happen needs two
rules. That is the right shape for it anyway — they have independent conditions,
independent histories and independent pause switches.

## The invariants

Four, and each prevents a specific failure rather than expressing a preference.

**Exactly one `PRIMARY`, and it is first.** Without it there is no defined
starting point, and "the rule's condition" — the thing the `Check if` node shows
and the rule list summarises — has no single answer. Two primaries would be two
rules sharing one trigger and one name.

**At most one `OTHERWISE`.** Two fallbacks are contradictory by construction:
both claim to run when nothing else matched, and only one can. Whichever the
ordering happens to pick, the other is dead code that looks live on the canvas.

**`OTHERWISE` is last.** A fallback in the middle is not a fallback — every
branch below it becomes unreachable, silently. Nothing in the interface would
show that, because each of those branches looks perfectly well-formed on its
own.

**`OTHERWISE` has no condition group.** A conditional fallback is an
`OTHERWISE_IF` wearing the wrong label, and it breaks the guarantee people rely
on: that the last branch always runs when nothing above did. A rule whose
fallback can itself fail to match is a rule that can do nothing while appearing
to cover every case.

## What actually enforces them

Very little, and this is the honest position rather than the intended one.

| Invariant                              | Enforced by                             |
| -------------------------------------- | --------------------------------------- |
| one branch per position                | `UNIQUE (ruleVersionId, position)`      |
| at most one condition group per branch | `UNIQUE` on `condition_groups.branchId` |
| exactly one `PRIMARY`                  | **nothing**                             |
| at most one `OTHERWISE`                | **nothing**                             |
| `OTHERWISE` is last                    | **nothing**                             |
| `OTHERWISE` has no conditions          | **nothing**                             |

There is no check constraint, no partial unique index, and no validation code —
because there is no code that writes branches at all yet. Anything inserting
into these tables today can produce a rule that violates every invariant above,
and nothing will object.

Two of the four are enforceable in the database and should be, rather than only
in a service that could be bypassed by a backfill script:

```sql
CREATE UNIQUE INDEX ON automation_branches ("ruleVersionId")
  WHERE type = 'PRIMARY';
CREATE UNIQUE INDEX ON automation_branches ("ruleVersionId")
  WHERE type = 'OTHERWISE';
```

"`OTHERWISE` is last" and "`OTHERWISE` has no conditions" need either a trigger
or a service-level check; the position of the highest row is not something a
per-row constraint can see.

## How a legacy rule maps onto this

Per the backfill described in
[the migration document](../database/automation-rule-migration.md):

- the flat conditions of a rule with no parentage become the `PRIMARY` branch's
  `ALL` group, and its actions become that branch's actions in `position` order
- a `BRANCH` node's `match` arm becomes the current branch's actions
- its `else` arm, if it contains another `BRANCH`, becomes the next
  `OTHERWISE_IF` — the chain unrolls into the list, in chain order
- an `else` arm containing only actions becomes the `OTHERWISE`

The mapping is total in one direction only. Every node tree the builder can
produce has a branch list; not every branch list has a node tree, because
ordering that the list expresses directly has no faithful representation as
parentage. That asymmetry is why the migration is phased forward and never back
— see the rollback positions in the migration document.

## Not yet implemented

- Branch evaluation. The runner does not read `automation_branches`.
- The `PRIMARY` / `OTHERWISE` uniqueness constraints described above.
- The "`OTHERWISE` is last" and "no conditions on `OTHERWISE`" checks.
- The `+ Add branch` menu with its two named entries. The builder today offers
  `Add branch` / `Otherwise if…` on an edge control
  (`automation-edge.tsx`), which splits the **node tree**, not a branch list.
- Branch reordering, and the drag handle reference 13 shows.
- Branch duplication and deletion as branch-level operations.

## Related

- [The structured rule model](./automation-rule-tree.md)
- [Condition groups](./automation-condition-groups.md)
- [The automation engine](./automation-engine.md) — what runs today
