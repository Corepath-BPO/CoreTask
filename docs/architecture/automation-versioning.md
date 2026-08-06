# Versioning and publishing

A rule points at two versions:

```prisma
model AutomationRule {
  draftVersionId     String? @unique
  publishedVersionId String? @unique
}
```

They are different rows. That single decision is what lets somebody edit a live
rule without the edits taking effect.

## Status: the tables exist, publishing does not use them

`automation_rule_versions` was created by
`20260807160000_automation_structured_rules`, along with the `draftVersionId`
and `publishedVersionId` columns on `automation_rules`.

**Nothing reads or writes them.** `AutomationsService.publish` validates the
node graph and sets `status = ACTIVE` and `publishedAt = now()`. It creates no
version row. `AutomationsService.update` replaces the rule's nodes in place and
increments `AutomationRule.version`, an integer counter — so a live rule's
definition changes the moment somebody saves, which is exactly the behaviour
this model exists to end.

Everything below describes the model. The final section says what runs today.

## Why two rows and not a draft flag

The cheap version of this is a `hasUnpublishedChanges` boolean and one set of
steps. It cannot work, because there is only one copy of the rule and the runner
reads it.

Consider a live rule that assigns to Dana and comments. Somebody opens it,
deletes the comment action, and goes to lunch mid-edit. With one copy the rule
now assigns and does not comment — on every task that fires it, for the whole
lunch break, with no publish and no intent. Autosave makes this worse rather
than better: the more responsive the editor, the more intermediate states get
executed.

Two rows make the question trivial. The runner reads `publishedVersion`. The
editor writes `draftVersion`. A half-finished edit is a row nothing executes,
and it can be saved as often as the editor likes.

The unique constraints on both columns say a version is the draft of at most one
rule and the published state of at most one rule. Without them a version row
could be shared, and publishing one rule would change another.

## What publish does

1. Validate the draft — structure, then references against the project.
2. Point `publishedVersionId` at the draft version.
3. Create the next draft: a copy of what was just published, carrying
   `version + 1`.
4. Stamp `publishedAt`, set `status = ACTIVE`.

Publishing does not mutate what is running. It points the rule at a different
row. The distinction matters at the moment of the swap: a running execution
holds the version it started with, so a publish mid-execution cannot change the
actions of a rule that is halfway through them.

Step 3 is what keeps "edit a published rule" cheap. Without a fresh draft, the
first keystroke after publishing would have to clone the published version
first, and a failure there leaves an editor with nowhere to write.

`version` is monotonic within a rule, enforced by `UNIQUE (ruleId, version)`.
The draft carries the next number, so the number in the interface is the one the
edit will publish as.

## Why draft edits never execute

The runner's query selects on the rule, and reads the rule's
`publishedVersionId`. A draft is reachable only through `draftVersionId`, which
nothing on the execution path touches.

This is a structural guarantee rather than a check that could be forgotten. There
is no code path in which a draft is a candidate for execution, so there is no
code path that has to remember to exclude it.

The corollary is worth stating: **a rule with a draft and no published version
has never run and cannot run.** A new rule is created as a `DRAFT`, whatever
status the request asks for, and `publish` is the only path to `ACTIVE`. A
half-built rule saved straight to `ACTIVE` would start acting on real tasks
before anybody had finished describing what it should do.

## Version history

Old versions are not deleted. `AutomationRuleVersion` rows accumulate per rule,
and the FKs from `automation_rules` are `ON DELETE SET NULL`:

> `SET NULL`, not `CASCADE`: losing a version must not delete the rule that
> points at it. A rule with no draft is recoverable; a rule that vanished is
> not.

Keeping history is what makes an execution explicable. An
`AutomationExecution` from three months ago records what happened; the version
that was published then records what the rule said at the time. Without it, the
only available explanation for an old run is the rule's current definition,
which may be unrecognisable.

The execution row does not yet carry a version id, so that link is not currently
possible — see below.

## Rule naming

`AutomationRuleNameMode` is `AUTO` or `MANUAL`. `AUTO` means the name is derived
from the trigger and re-derived when the trigger changes; `MANUAL` means
somebody typed it and it is never overwritten.

The migration defaults every existing rule to `MANUAL`, because each of their
names was typed by somebody and re-deriving one from its trigger would rename
their rule during a deployment. A default of `AUTO` would have been a silent
mass edit dressed up as a schema change.

## What runs today

| Concern                      | Today                                               |
| ---------------------------- | --------------------------------------------------- |
| Where a rule's steps live    | `automation_nodes`, on the rule itself              |
| Saving                       | `PATCH :ruleId` with `nodes` — replaces the canvas  |
| Effect of saving a live rule | takes effect immediately                            |
| Publish                      | validates, sets `status = ACTIVE` and `publishedAt` |
| `AutomationRule.version`     | an integer bumped on every node-replacing save      |
| `AutomationRuleVersion`      | table exists, zero rows written by the application  |

The two things called `version` are not the same thing and will need
disambiguating when versions are wired up. `AutomationRule.version` counts saves
of the node graph; `AutomationRuleVersion.version` numbers versions of a rule.
Reusing the name on the rule row for the pointer-holder is how somebody ends up
comparing a save counter with a version number.

## Not yet implemented

- Writing version rows. Nothing creates an `AutomationRuleVersion`.
- Publish pointing at a version rather than flipping a status.
- The runner reading `publishedVersion`.
- Debounced draft saving. The builder saves through `PATCH :ruleId`, which
  replaces the live definition.
- Any endpoint for version history, or for reverting to a previous version.
- A version id on `AutomationExecution`, without which an old run cannot be
  matched to the definition that produced it.
- The autosave indicator in the builder header that milestone 4 calls for.

## Related

- [The structured rule model](./automation-rule-tree.md)
- [The REST surface](../api/automation-rules.md)
- [The phased migration](../database/automation-rule-migration.md)
