# Condition groups

A branch is chosen by a **condition group**: an operator and an ordered list of
conditions.

```prisma
model AutomationConditionGroup {
  branchId   String                 @unique
  operator   ConditionGroupOperator @default(ALL)   // ALL | ANY
  conditions AutomationCondition[]
}

model AutomationCondition {
  fieldKey String   // `status`, `sectionId`, `customField:<id>`
  operator String   // EQUALS, CONTAINS, IS_EMPTY, …
  value    Json     // scalar, or a list for the `one of` forms
  position Int
}
```

## Status: modelled, not evaluated

The tables exist. **Nothing reads or writes them.** What runs today is
`AutomationRunnerService.conditionHolds`, against `AutomationNode` rows, with
`ALL` semantics only — either every flat condition holds, or the rule is
`SKIPPED` with the first failing one named.

`ANY` has no implementation. `@coretask/contracts` says so at the point it
declares the constant:

> `ALL` is what the runner does today — every condition must hold. `ANY` needs
> runner support before the builder offers it.

## ALL and ANY are properties of a group, not operators between conditions

Two ways to model "status is Waiting or priority is Critical":

1. An operator on each condition, joining it to the one before — `A AND B OR C`.
2. A mode on the group, applying to all of its members — `ANY of [A, B, C]`.

The second is what is stored, for three reasons.

**Precedence has no answer in the first.** `A AND B OR C` means different things
depending on how a reader binds it, and every reader binds it differently. A
rule that means one thing to its author and another to the engine is worse than
one that cannot be written.

**A per-condition operator is undefined on the first condition.** The leading
row has nothing to join to, so its operator column is either meaningless or a
special case every reader has to know about. A group-level mode has no such row.

**Reordering changes meaning in the first and not the second.** Conditions are
reorderable — that is why they carry a `position`. Under a per-condition
operator, dragging the third condition to the top silently rewrites the boolean
expression. Under a group mode it changes nothing except the order they are read
in, which is what somebody dragging a row expects.

Filter builders across the industry landed on the same answer, which is why
`ConditionGroupOperator` and the view filters' `ConditionMatch` in
`@coretask/contracts` agree.

## Why the interface says AND and OR

The stored values are `ALL` and `ANY`; the builder shows **AND** and **OR**.

That is not sloppiness in either direction. `ALL` and `ANY` are the honest names
for a mode over a set — "ALL of these must hold" is exactly what the column
means, and "AND of these" is not English. But the control the person operates
sits between two rows, and there the word that reads correctly is the one that
joins them: `status is Waiting` **AND** `priority is High`.

The rule is: storage names the property, the interface names the relationship
the person is looking at. Storing `AND` would be storing a rendering of the
value, and the first time the interface is reworded the database would carry the
old wording forever.

## One group per branch, and it is flat

`AutomationConditionGroup.branchId` is `@unique`, so a branch has at most one
group. `AutomationCondition` belongs to a group and has no children.

**There is no nesting.** No `parentGroupId`, no self-relation, no group inside a
group. A mixed expression such as `A AND (B OR C)` cannot be stored, and this is
worth stating plainly because the shape of the brief invites the opposite
reading: nested mixed groups are not modelled-but-hidden, they are not modelled.

What was traded away and why:

- **Gained.** A group is one row with a mode, and evaluating it is one pass over
  a list. There is no recursion in the runner, no depth limit to pick, and no
  way for a malformed group to make evaluation loop.
- **Gained.** The canvas can render a branch's condition as one node. A nested
  expression has no single-node rendering, so exposing nesting means designing a
  nested editor first — which is the reference set's own answer, since none of
  the thirteen references show one.
- **Lost.** `A AND (B OR C)` needs two branches, or two rules.

Adding nesting later is additive: a nullable `parentGroupId` on
`automation_condition_groups`, and existing rows are roots. Nothing about the
current shape forecloses it, which is the property that made flat acceptable as
a first cut.

## What a condition compares

`fieldKey` names the thing being read. The convention is a bare field name for
task columns (`status`, `priority`, `sectionId`, `assigneeId`, `title`,
`dueDate`, `startDate`) and a prefixed form for anything indirected —
`customField:<id>`.

The prefix is what stops a custom field named "status" from colliding with the
task's own status column. Without it, the runner would have to guess which one a
key means, and the guess would be wrong exactly when somebody had named a field
after a built-in one.

The value's shape follows the operator, not the field: a scalar for `EQUALS`, an
array for `IN` and `NOT_IN`, and nothing at all for `IS_EMPTY` and
`IS_NOT_EMPTY`. `operatorTakesValue` in `@coretask/contracts` is the single
answer to which is which, shared with the view filters so the two cannot drift.

## Operators are type-aware

`OPERATORS_BY_VALUE_KIND` restricts which operators a field may be compared
with. "Date contains High" and "Checkbox greater than 10" are combinations that
parse, store and then never match — a rule that is broken in a way nothing
reports.

The check runs in two places on purpose. `validateCondition` in
`@coretask/validation` runs in the browser, so the form can refuse the
combination without a round trip per keystroke; the same function runs in
`AutomationGraphValidatorService`, because a form is not a check and the
endpoint accepts requests from anywhere.

## An unknown operator is false

`conditionHolds` ends with:

```ts
default:
  // An unknown operator does not silently pass. A condition nobody can
  // evaluate must block the rule, not wave it through.
  return false;
```

This is the one place the choice between fail-open and fail-closed is not
obvious, so it is worth naming the reasoning. A condition exists to stop the
rule in some circumstances. If the engine cannot tell whether this is one of
them, running the actions anyway performs writes on somebody's tasks on the
strength of a comparison nobody made. Refusing produces a `SKIPPED` execution
with a reason, which is visible and reversible.

## Not yet implemented

- `ANY`. The enum value exists; the runner has no code for it, and the builder
  does not offer the choice.
- Nested groups, per the section above.
- Conditions on custom fields. `fieldKey` documents the `customField:<id>` form,
  and `AutomationMetadataService.conditionFields` returns seven built-in fields
  and no custom ones, so nothing can currently produce such a key.
- The condition catalogue references 08–11 show: search, grouped entries, custom
  fields as pills, and the AI entry.
- `BEFORE` and `AFTER`. They are declared in `OPERATORS_BY_VALUE_KIND` for
  `DATE` fields and accepted by validation, but `conditionHolds` has no case for
  them — so a date comparison written with either falls to the default and
  evaluates false. A rule using one is publishable and never matches.

## Related

- [The structured rule model](./automation-rule-tree.md)
- [Branches](./automation-branches.md)
- [The automation engine](./automation-engine.md)
