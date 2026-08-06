# The structured rule model

A rule is a trigger and an **ordered list of branches**. Each branch is a
condition group and an **ordered list of actions**. That is the whole shape.

```
AutomationRule
  └── AutomationRuleVersion         draft, and published history
        ├── triggerType + triggerConfig
        └── AutomationBranch[]       ordered; PRIMARY | OTHERWISE_IF | OTHERWISE
              ├── AutomationConditionGroup?   ALL | ANY
              │     └── AutomationCondition[] ordered
              └── AutomationAction[]          ordered
```

Read [the rule builder rebuild](./asana-parity-rule-builder.md) first — it says
why the previous model is being replaced. This document says what replaces it
and what the replacement costs.

## Status: the tables exist, nothing uses them yet

`automation_rule_versions`, `automation_branches`,
`automation_condition_groups`, `automation_conditions` and `automation_actions`
were created by `20260807160000_automation_structured_rules`. They are declared
in `schema.prisma` and generated into the Prisma client.

**No code reads or writes any of them.** The runner still walks
`automation_nodes`, the API still saves and returns nodes, and the builder still
edits a node graph. Everything below describes the model the tables encode, not
behaviour you can observe today. Where a section describes something that
already runs, it says so.

## Why ordering is an integer column and not parentage

In the node tree, "A then B" is expressed as B being A's child. That makes four
ordinary edits expensive or ambiguous:

| Edit                     | With parentage                                      | With a position column         |
| ------------------------ | --------------------------------------------------- | ------------------------------ |
| Swap two actions         | rewrite both parent links and everything downstream | write two integers             |
| Insert between two steps | re-parent the tail of the chain                     | write one row, shift the tail  |
| Delete the middle step   | re-parent its child onto its parent                 | delete one row, shift the tail |
| "Which branch is third?" | walk the chain from the root                        | `WHERE position = 2`           |

The editor already pays for this: inserting a step needs a `reparented` edit map
in `graph-edits.ts` purely to keep the chain consistent. That map is not
complexity anyone chose — it is the model's shape leaking into the editor.

The deeper problem is that parentage claims something ordering does not. A
parent link says "B is reachable only through A". For two actions in the same
branch that is false: they both run, unconditionally, one after the other.
Encoding a list as a chain means every reader has to know that this particular
chain does not mean what a chain usually means.

So `position` is an `INTEGER` on `AutomationBranch`, `AutomationCondition` and
`AutomationAction`, each with a unique constraint scoped to its parent:

```sql
CREATE UNIQUE INDEX "automation_branches_ruleVersionId_position_key"
  ON "automation_branches" ("ruleVersionId", "position");
```

### What the unique constraint costs

It is not free, and pretending otherwise would leave the next person surprised.
The index is non-deferrable, so a naive swap —

```sql
UPDATE automation_actions SET position = 1 WHERE id = 'a';
UPDATE automation_actions SET position = 0 WHERE id = 'b';
```

— fails on the first statement, because position 1 is still taken. A reorder has
to move the moving row out of the way first (a negative position works, since
nothing else uses one), or renumber the whole list in one pass inside a
transaction.

That was accepted deliberately. The alternative — no constraint — permits two
branches at position 2, and then "which one runs first" is decided by whatever
`ORDER BY` tie-break the query planner happens to pick. A rule whose behaviour
depends on physical row order is a rule nobody can reason about, and the failure
is silent. A failed reorder is loud.

## Why the trigger is on the version and not in a table

`AutomationRuleVersion` carries `triggerType` and `triggerConfig` as columns. A
`AutomationTrigger` table would hold exactly one row per version, forever, and
buy nothing: a trigger has no ordering, no siblings, and no independent
lifecycle.

`AutomationRule.triggerType` stays denormalised on the rule as well, because it
is the matcher's index — `(projectId, status, triggerType)` is how the runner
finds candidate rules without loading anybody's steps. Two copies of one fact is
a real risk, and the mitigation already exists on the node path:
`AutomationsService.update` derives the rule's trigger columns from the saved
trigger node rather than trusting the caller to send both. Publishing a version
must do the same, for the same reason — a rule that displays one trigger and
fires on another is indistinguishable from a rule that does not work.

## The canvas is a projection

The layout is derived, never stored. `layoutGraph` in
`web/src/features/automations/builder/lib/layout.ts` already computes positions
from the rule's shape; today it walks parentage, and under this model it walks
branches instead:

- branch `n` renders on row `n`
- its condition group is one node at column 1
- its actions are nodes at columns 2, 3, 4… in `position` order

```
When ─┬─ Check if ──── Do this ──── Do this
      ├─ Otherwise if ─ Do this
      └─ Otherwise ──── Do this
```

Reading down the column gives the questions; reading across gives the answers.

Coordinates used to be stored per node, which is how the drawing came to
disagree with the rule: insert a step in the middle and every stored position
after it describes where things used to be. Deriving the layout means the
picture cannot be wrong about the rule, because it is computed from it. That is
already fixed on the node path — this model keeps the fix and removes the reason
it was needed.

The geometry constants are shared in `@coretask/contracts` (`GRAPH_LAYOUT`), so
the server and the client cannot lay out the same rule differently. See
[the builder parity criteria](../ui/automation-builder-parity.md).

## What this model does not express

Honest boundaries, so nobody designs against a capability that is not here:

- **No nesting of branches.** A branch cannot contain another branch. An
  if/else-if chain is a flat list, which is what the references show and what
  people mean; anything deeper needs a second rule.
- **No nesting of condition groups.** One group per branch, one flat list of
  conditions inside it. See
  [condition groups](./automation-condition-groups.md).
- **No parallel branches.** Evaluation is top to bottom, first match wins. Two
  branches never both run. See [branches](./automation-branches.md).
- **No delays or waits.** `AutomationNodeType.DELAY` exists on the legacy model
  and nothing executes it; the structured model does not carry it forward.

## Related

- [The rule builder rebuild](./asana-parity-rule-builder.md) — the anchor
- [Branches](./automation-branches.md)
- [Condition groups](./automation-condition-groups.md)
- [Versioning](./automation-versioning.md)
- [The phased migration](../database/automation-rule-migration.md)
