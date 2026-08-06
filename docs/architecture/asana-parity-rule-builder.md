# The rule builder rebuild

## Why the current builder is being replaced

The builder that exists today was grown from a node graph outwards. It draws a
tree of `AutomationNode` rows, each with a `parentNodeId` and a `branchKey`, and
the runner walks that tree. It works, and everything in it is real — but the
model it is built on cannot express the thing the product needs to be.

Three specific failures, each of which is structural rather than cosmetic:

**A branch is not a node.** In the current model a `BRANCH` row holds a single
comparison and has two arms. "Otherwise if" therefore has to be built by nesting
a branch inside the previous branch's else arm. That works — the runner walks it
— but nothing in the data says "these are the ordered alternatives of one rule".
Reordering them means rewriting a chain of parent links. Asking "does this rule
have an otherwise?" means walking to the end of a chain. A branch is an ordered
member of a list, and the model has no list.

**A condition is not a group.** One `CONDITION` row holds one comparison. There
is no way to say "status is Waiting **or** priority is Critical" on one arm.
`ALL`/`ANY` has nowhere to live.

**Actions are not ordered within a branch.** They are children in a chain, so
"run A then B" is A-parent-of-B. Reordering two actions rewrites parentage, and
inserting between them re-parents everything downstream. That is why inserting a
step needed a `reparented` edit map in the editor at all.

Underneath those: the canvas position was stored per node, so the drawing could
disagree with the rule. That one is already fixed — layout is derived — but it is
the same root cause. **The visual tree was being used as the business model.**

## What each reference shows

| Ref | What it demonstrates | What it requires |
| --- | --- | --- |
| 01 | The default canvas: `When` → `Check if` → `+ Do this…` horizontally, a junction dot on the trigger's outgoing connector, and a dashed drop from that junction to an `+ Add branch` pill. Header shows project name, rule name, status badge. | Three default nodes, a shared junction that owns the branch line, no name input on the canvas. |
| 02 | The `When` inspector. Breadcrumb `When… /`, title `Task is moved to a section`, delete and collapse. Body: one field, `Choose an option`, with `Section is changed` / `Section is…` / `Section is not…` / `Section is one of…`. | Four distinct trigger configurations, not four labels. |
| 03 | The `Check if` inspector. Breadcrumb `Check if… /`, title `Section is`. Two fields: the operator, then `Choose a column/section` with a real section. | Condition operator and value as separate fields; value list from the project. |
| 04–06 | The action catalog, scrolled top to bottom. Header `Do this…` with a subtitle, a search box, tabs `Actions` / `External actions`, then grouped rows with icons: Move task, Change status, Change task field to…, Change custom field to… (each naming a real field as a pill), Create new, Convert task to…, Add to task. | Grouped searchable catalog; custom-field entries generated from the project's fields; a visible but unavailable External actions tab. |
| 07 | The `+ Add branch` menu: `Otherwise if…` ("Add another set of conditions and actions to this rule.") and `Otherwise` ("Add actions that will run if all other conditions are not met."). | Two named branch types with descriptions — not a generic "add branch". |
| 08–11 | The condition catalog for `Otherwise if…`. Header + subtitle, `Search conditions`, groups: Create your own (AI), Task moved, Task field is…, Status is…, Task details, Custom field is… (fields as pills), Task has… | Same catalog shape as actions; AI entry present but not functional; custom-field conditions generated. |
| 12 | The `Otherwise` branch on canvas: a node reading `Otherwise / If all other conditions are not met`, connected to its own `+ Do this…`. | A fallback branch node with no condition and its own actions. |
| 13 | A configured `Otherwise if` node: drag handle on the left of the junction dot, an ellipsis menu on the card's right, and a `+` button on the card's **bottom** edge. | Three connector positions per node, revealed on hover; a drag handle for branch reordering. |

## The model this requires

A rule is a trigger and an **ordered list of branches**. Each branch is a
condition group and an **ordered list of actions**. That is the whole shape, and
every requirement above falls out of it:

```
AutomationRule
  └── AutomationRuleVersion         (draft, and published history)
        ├── trigger                  (type + configuration)
        └── branches[]               ordered; PRIMARY | OTHERWISE_IF | OTHERWISE
              ├── conditionGroup?    ALL | ANY, with ordered conditions
              └── actions[]          ordered
```

Ordering is an integer `position` on branches, conditions and actions — so
reordering is one column write, not a re-parenting walk. `OTHERWISE` carries no
condition group and is constrained to be last and unique.

The canvas is then a **projection** of this: branch `n` renders on row `n`, its
condition group as one node, its actions as a row of nodes to the right. The
layout function already added (`layoutGraph`) is the right idea applied to the
wrong input; it becomes a projection of branches rather than a walk of parentage.

## Compatibility

The existing `AutomationNode` tree is live data with rules running against it.
The plan is additive and phased, per the brief:

1. **Read both.** New tables land alongside `AutomationNode`. Nothing is dropped.
2. **Backfill.** Every existing rule gets a `AutomationRuleVersion` built from
   its node tree: trigger from the `TRIGGER` node, the flat conditions into the
   primary branch's `ALL` group, the actions into the primary branch in order.
   A nested branch chain maps to `OTHERWISE_IF` branches in chain order.
3. **Edit structured only.** The builder writes versions; the node tree stops
   being written.
4. **Execute structured, verify, then remove.** The runner reads the published
   version. Only after a verification window do the legacy columns go.

No step deletes anything another step still needs.

## Milestones

Each ends with format, lint, typecheck, test, build, and a commit.

| # | Milestone | Deliverable |
| --- | --- | --- |
| 1 | Discovery and mapping | This document. |
| 2 | Canonical model | Prisma models, additive migration, shared contracts and types, Zod schemas. |
| 3 | Metadata and validation | `automation-metadata` returning triggers, condition types, action types, sections, statuses, priorities, members, custom fields, capabilities, permissions. Structural + reference validation against the new model. |
| 4 | Builder shell | Header with inline title, status badge, autosave indicator, Settings, Publish, Close. Structured canvas with the junction and default nodes. |
| 5 | Inspectors | One inspector shell; trigger, condition, condition catalog, action catalog, action config. |
| 6 | Branches | Add-branch menu, otherwise-if, otherwise, ordering, duplication, deletion, hover connectors. |
| 7 | Groups and ordering | AND/OR, multiple conditions, multiple ordered actions, duplication, reordering. |
| 8 | Versioning and execution | Debounced draft save, publish, compile, runner on the published version, execution steps. |
| 9 | Legacy migration | Backfill command, adapter, comparison, rollback. |
| 10 | Tests and parity | Unit, integration, Playwright, visual snapshots, accessibility, docs. |

## What is deliberately not in this plan

- **AI conditions and AI drafting.** Present in the references, feature-flagged
  off here. There is no model behind them and a fake one is worse than a gap.
- **External actions.** The tab exists for structural parity and says it will be
  available later. No fake integrations.
- **Form and email task creation conditions.** Those modules do not exist.
- **Approvals, convert-to-project.** Not supported by CoreTask today.

Each of these renders disabled with a reason rather than being hidden, per the
existing convention: absence reads as "never considered", a greyed row with a
reason reads as "not yet".
