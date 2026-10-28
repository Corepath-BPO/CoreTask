# Condition groups

A branch is chosen by its **Check if** step: one comparison, or a group of
them.

```ts
// one comparison
{ field: 'priority', operator: 'IS', value: 'HIGH' }

// a group: ALL of its entries, or ANY of them; an entry may be a group
{
  match: 'ALL',
  conditions: [
    { field: 'sectionId', operator: 'IS', value: '019f…' },
    { match: 'ANY', conditions: [
      { field: 'priority', operator: 'IS', value: 'HIGH' },
      { field: 'priority', operator: 'IS', value: 'CRITICAL' },
    ] },
  ],
}
```

That is the configuration of one `CONDITION` node. The whole group lives on
the one step, so the canvas still draws one card per branch and the runner
still takes the first branch whose card holds. The shape and every reading of
it — `isConditionGroup`, `conditionLeaves`, `mapConditionLeaves`,
`evaluateCondition`, `conditionGroupProblems` — are in
`@coretask/contracts` (`automation-condition-groups.ts`), because four places
read it and must read it alike: the runner, the validator, the builder, and the
template library.

## ALL and ANY are properties of a group, not operators between conditions

Two ways to model "status is Waiting or priority is Critical":

1. An operator on each condition, joining it to the one before — `A AND B OR C`.
2. A mode on the group, applying to all of its members — `ANY of [A, B, C]`.

The second is what is stored, for three reasons.

**Precedence has no answer in the first.** `A AND B OR C` means different things
depending on how a reader binds it, and every reader binds it differently. A
rule that means one thing to its author and another to the engine is worse than
one that cannot be written. With groups, `A and (B or C)` is written as exactly
that: an `ALL` group holding `A` and an `ANY` group.

**A per-condition operator is undefined on the first condition.** The leading
row has nothing to join to, so its operator column is either meaningless or a
special case every reader has to know about. A group-level mode has no such row.

**Reordering changes meaning in the first and not the second.** Under a
per-condition operator, moving the third condition to the top silently rewrites
the boolean expression. Under a group mode it changes nothing except the order
they are read in.

Filter builders across the industry landed on the same answer, which is why the
group's `match` and the view filters' `ConditionMatch` in `@coretask/contracts`
are the same constant.

## Why the interface says "and" and "or"

The stored values are `ALL` and `ANY`; between two entries the builder writes
**and** or **or**, and the group's own control reads "All of these are true" /
"Any of these is true".

Storage names the property, the interface names the relationship the person is
looking at. Storing `AND` would be storing a rendering of the value, and the
first time the interface is reworded the database would carry the old wording
forever.

## How it runs

`AutomationRunnerService.conditionHolds` hands the step's configuration to
`evaluateCondition` with a function that judges one comparison
(`comparisonHolds`, the operator switch every condition has always gone
through). `ALL` holds when every entry does and `ANY` when at least one does,
and a nested group is judged the same way, recursively. Ticket rules do the same
with the ticket's own comparisons.

**An empty group holds nothing.** A question with no parts has no answer, and a
condition nobody can evaluate blocks the rule rather than waving it through —
the same reasoning as the unknown operator below. The validator refuses an empty
group before it is ever published, so this is only the backstop.

The fallback row (`{ fallback: true }`) holds unconditionally, grouped or not.

## The limits

- **Three levels of group** (`MAX_CONDITION_GROUP_DEPTH`): a group, a group
  inside it, and one inside that. Every walk of a stored group stops there, so a
  malformed one cannot hang the worker.
- **Twenty comparisons per step** (`MAX_GROUP_CONDITIONS`). Past that a rule is
  better as branches.
- **No AI check inside a group.** "Check with AI" asks a model; as a step of its
  own its answer and reason are logged as that step's, and a group would bury
  them. It stays a branch of its own.

`conditionGroupProblems` names each of these by its path inside the step —
`conditions.1.conditions.0` — and so does every comparison's own problem
(`validateCondition` takes the path), so the builder can say which entry is at
fault.

## The builder

A plain **Check if** panel has **Add another condition**, which turns the step
into an `ALL` group of the comparison and an empty one. A group's panel shows:

- **Check that** — All of these are true / Any of these is true;
- each comparison as a card with its field (from the condition catalogue, less
  what the rule's subject cannot ask and the AI check), its comparison and its
  value, and a remove button;
- **and** / **or** between entries;
- **Add condition** and **Add group** (a nested group asks the other way round by
  default, because that is what nesting is for). Below the depth limit only.

Removing the second-to-last comparison of the outer group makes the step a
single comparison again. The card reads the group as a sentence —
"Priority is High or Priority is Critical", nested groups in parentheses — and
names the first three entries before counting the rest.

## Everything else that reads conditions

| Reader                                   | What it does with a group                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateGraphStructure`                 | shape problems, then each comparison like a single one                                                                                            |
| `AutomationGraphValidatorService`        | field kinds, custom-field references, ticket fields — per comparison                                                                              |
| `rulesForSection` (section lightning)    | a section checked anywhere in the group, `ALL` or `ANY`                                                                                           |
| Rule library (save and apply)            | names and translates the ids inside every comparison                                                                                              |
| `compileDefinition` (structured → nodes) | a branch's condition group becomes one grouped step                                                                                               |
| `convertLegacyRule` (nodes → structured) | an `ALL` group of comparisons unrolls into the branch's list; an `ANY` group or a nested one cannot be expressed there and is dropped with a note |

## What a condition compares

`field` names the thing being read: a bare name for task columns (`status`,
`priority`, `sectionId`, `assigneeId`, `title`, `dueDate`, `startDate`, …) and a
prefixed form for anything indirected — `customField:<id>`. The prefix is what
stops a custom field named "status" from colliding with the task's own status
column.

An empty field never matches a number comparison (greater than, less than, the
inclusive bounds, between), just as it never matches a view filter. Nothing is
not zero. Asking about an empty field is what "is empty" is for.

A formula field is compared as a number. Its value is never stored, so the
runner works out the project's formulas once per event, when it loads the task
(`formulasFor`), with the same evaluator the task list uses. "Days to complete
is less than 1" therefore reads what the board shows. A formula is a condition
only: nothing changes it, so it is never a trigger, and nothing may set it, so
it is never an action.

The value's shape follows the operator, not the field: a scalar for `IS`, an
array for `IS_ONE_OF`, nothing at all for `IS_EMPTY`. `operatorTakesValue` in
`@coretask/contracts` is the single answer to which is which, shared with the
view filters so the two cannot drift.

## Operators are type-aware

`OPERATORS_BY_VALUE_KIND` restricts which operators a field may be compared
with. "Date contains High" and "Checkbox greater than 10" parse, store and then
never match — a rule that is broken in a way nothing reports. The check runs in
the browser (`validateCondition` in `@coretask/validation`) and again in
`AutomationGraphValidatorService`, because a form is not a check.

## An unknown operator is false

`comparisonHolds` ends with:

```ts
default:
  // An unknown operator does not silently pass. A condition nobody can
  // evaluate must block the rule, not wave it through.
  return false;
```

If the engine cannot tell whether a condition holds, running the actions anyway
performs writes on somebody's tasks on the strength of a comparison nobody made.
Refusing produces a `SKIPPED` execution with a reason, which is visible and
reversible.

## The structured model

`AutomationConditionGroup` (`ALL` | `ANY`, one per branch, flat) is the
structured definition's version of a group. It cannot nest; the node shape
above can. Publishing a structured rule compiles its group into one grouped
condition step, so its `ANY` runs.

## Related

- [The structured rule model](./automation-rule-tree.md)
- [Branches](./automation-branches.md)
- [The automation engine](./automation-engine.md)
