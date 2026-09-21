# 0015. Formula fields are computed on read

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

Asana's Formula field shows a number worked out from other fields on the same
task — `{Effort} * {Rate}`, `days_between({Start}, {Due})`. CoreTask needed one
for parity, and the first question was where its value lives.

Three shapes were considered:

1. **Store it** in `task_custom_field_values.numberValue` like any number, and
   recompute whenever an operand changes.
2. **Compute it on read**, appending a value to each row after the stored rows
   are fetched, and never write it anywhere.
3. **Compute it in SQL**, as a generated expression the list query evaluates.

## Decision

Formula values are **computed on read** and never stored (shape 2).

`FormulaValuesService.plan(projectId)` parses the project's formula expressions
once per request — one indexed query, returning `null` for the common case of a
project with no formulas — and `compute(plan, rows)` evaluates them over the
page of rows in hand, memoised per task, following a formula that names another
formula and refusing a cycle with `null` rather than a stack overflow. Every path
that returns rows appends the result: the view query, the subtask list, and the
project work-item reads and writes.

The expression grammar and evaluator are a pure module in `@coretask/contracts`,
shared with the client, so what parses on one side parses on the other.
References are by field id, `{field:<uuid>}`; the editor shows names and
converts at the edges.

Formulas are **not stored, not filterable and not sortable** in this pass. A
filter or sort naming one is refused by name with a 400. `PUT` on a formula is
a 422, and the type carries `isComputed: true` in the field-type catalog so the
bulk bar, the rule builder and the import leave it out by one rule.

## Consequences

- A formula is always right. There is no recomputation to get wrong, no
  operand change to miss, no rule that writes a value the next read overwrites.
  Every bug in shape 1 that the team has seen elsewhere — a total that lagged
  its inputs by one save — is impossible here.
- The cost is a handful of arithmetic evaluations per row per page. A page is
  at most 200 rows and a project rarely has more than a few formulas; the work
  is far below the cost of the query that fetched the rows.
- Filtering and sorting by a formula would need shape 3 or a cache. Neither is
  ruled out; both are deferred until somebody needs them, and the grammar was
  kept small enough (`+ - * /`, two functions) that shape 3 is a translation
  rather than a rewrite.
- A field a formula reads cannot be removed from the project until the formula
  is, and a formula cannot be attached to a project lacking its operands. Both
  are refused by name at the API. Without those two rules a formula could go
  blank without a word, which is worse than being told.
- Dates in `days_between` and `today()` are compared at UTC midnight, so a
  formula's value does not depend on which side of midnight the reader is.
