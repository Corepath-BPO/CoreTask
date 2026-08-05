# 0013. A node tree for automation rules

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

An automation rule is a trigger, some conditions, some actions, and eventually
branches. Two storage models were available, and the spec was explicit that
mixing them is not an option:

1. **Normalised tables** — `AutomationTrigger`, `AutomationCondition`,
   `AutomationAction`, each with its own columns
2. **A node tree** — one `AutomationNode` table with a discriminator, a parent
   and an ordinal

Normalised tables give each kind exactly the columns it needs and let the
database enforce shape. That is genuinely attractive for triggers and
conditions, which have stable fields.

It stops being attractive at branches. A branch has arms, each arm holds an
ordered sequence of further nodes, and any of those may itself be a branch. Three
normalised tables would need a parent pointer, a branch key and a position added
to each of them — which is a node tree, written three times.

## Decision

**One `AutomationNode` table** with `nodeType`, `subtype`, JSON `configuration`,
`parentNodeId`, `branchKey` and `position`.

`AutomationRule.triggerType` is denormalised from the trigger node, so matching
an event is one indexed query on `(projectId, status, triggerType)` rather than a
join through every rule's nodes.

## Consequences

Good:

- branches and nesting are expressible without a schema change
- a visual builder edits exactly this shape, so there is no translation layer
  between what is drawn and what is stored
- adding a trigger or action type is a new `subtype` string plus a case in the
  runner — no migration

Costs:

- `configuration` is JSON, so the database cannot enforce that an `ASSIGN_USER`
  node has a `userId`. Validation moved to publish time, which is arguably where
  it belongs — a draft is allowed to be incomplete — but it is application
  validation rather than a constraint
- `subtype` is a string, so a typo is a rule that never runs. Publish validation
  checks it against the executable set, which is why publish is the only path to
  ACTIVE
- reading a rule means assembling a tree in application code

Consequence worth naming: the builder replaces nodes **wholesale** on update
rather than diffing them. A canvas arrives as it now stands, and reconciling that
against stored rows means guessing which node is "the same" one — guessing wrong
silently rewires a rule. `version` records that the shape changed.
