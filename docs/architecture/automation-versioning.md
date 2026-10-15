# Versioning and publishing

A rule has a **draft** and, once published, a **published version**, and they
are different things. The builder edits the draft; the runner reads the
published version and nothing else. That single decision is what lets somebody
edit a live rule — and the builder save it as they type — without the edits
taking effect.

```
AutomationRule
  ├── automation_nodes          the draft: what the builder edits and saves
  ├── triggerType/Config        the draft's trigger
  └── publishedVersionId ──► AutomationRuleVersion
                                 version          1, 2, 3… within the rule
                                 nodes            the node tree, as published
                                 triggerType/Config
                                 name, createdBy, createdAt
```

## Why two copies and not a draft flag

The cheap version of this is a `hasUnpublishedChanges` boolean and one set of
steps. It cannot work, because there is only one copy of the rule and the runner
reads it.

Consider a live rule that assigns to Dana and comments. Somebody opens it,
deletes the comment action, and goes to lunch mid-edit. With one copy the rule
now assigns and does not comment — on every task that fires it, for the whole
lunch break, with no publish and no intent. Autosave makes this worse rather
than better: the more responsive the editor, the more intermediate states get
executed. Before versions, the builder autosaved only rules that were not
running, and an active rule's Save said it applied at once.

With two copies the question is trivial. The editor writes the draft, as often
as it likes; the runner reads the published version. A half-finished edit is a
set of rows nothing executes.

## What a version holds

`AutomationRuleVersion.nodes` is the rule's node tree as it stood when it was
published — each node's `id`, `nodeType`, `subtype`, `configuration`,
`parentNodeId`, `branchKey` and `position`, the row shape of `automation_nodes`
— beside the trigger it was published with and the rule's name at the time.

JSON rather than a second set of node rows, for the reason a template is JSON
(see [the engine](./automation-engine.md#the-rule-library)): a published version
is never edited, validated in place or partly read. The runner reads it whole
and a revert copies it whole, so rows would be structure with no query to
serve — and every reader of `automation_nodes` would have to remember to leave
the published ones out.

`version` counts up within a rule, enforced by `UNIQUE (ruleId, version)`.
`AutomationRule.version` is something else: a count of draft saves, which the
API has always returned. The builder shows the published version's number.

## What publish does

`AutomationsService.publish`:

1. Validates the draft — the same checks `/validate` runs, plus the rule's own
   trigger columns.
2. Compares the draft with the version running: same trigger, same
   configuration, and the same steps in the same places. Ids do not count —
   a restored version or a template's copy has fresh ones — so steps are named
   by their path from the trigger instead (`sameGraph`).
3. If they differ, creates the next version from the draft. If not, keeps the
   running one: a second press of Publish, or resuming a paused rule, does not
   add a copy to the history.
4. Points `publishedVersionId` at it, sets `status = ACTIVE`, stamps
   `publishedAt`.

Publishing does not mutate what is running. It points the rule at a different
row. Two publishes racing for the same number fail on the unique index, and the
loser gets `409`.

`enable` is publish. A rule may have gone stale while it was paused — a deleted
section, a member who left — and it is validated again on the way back on.

## What the runner reads

`AutomationRunnerService.runnableRules` finds candidate rules by the
**published version's** trigger:

```ts
where: { status: ACTIVE, publishedVersion: { is: { triggerType: event.trigger } } }
```

and runs that version's `nodes` with that version's `triggerConfig`. The clock
finds scheduled and date-triggered rules the same way, and "Run rule" checks the
published trigger. The rule's own `triggerType`/`triggerConfig` columns describe
the draft — the builder derives them from the trigger node on every save — so a
trigger changed in the builder takes effect when it is published, not when it is
typed.

An `ACTIVE` rule with no published version runs nothing; the runner logs a
warning. Publishing cannot leave a rule in that state, so a rule in it was
switched on some other way.

Every run records the version it executed (`AutomationExecution.ruleVersionId`),
and the run history shows it. Without that, the only available explanation of
an old run is the rule's current definition, which may be unrecognisable.

### A run that waits

A run that reaches a Wait step stores the version it is running on the
`AutomationDelayedRun`, and the clock republishes the event naming it
(`resumeVersionId`). The resumed run finishes on that version, even if the rule
has been republished since: what a run does next does not change halfway
through it. Such a run is matched by its rule alone, since a later version may
listen for a different trigger.

## History and revert

`GET /:ruleId/versions` lists the published versions, newest first, and
`GET /:ruleId/versions/:versionId` returns one with its steps as a graph.

`POST /:ruleId/versions/:versionId/revert` copies a version's steps and trigger
**into the draft**. Nothing running changes until somebody publishes, which
validates the old steps against the project as it is now — the section an old
version moved tasks into may be gone. `publish: true` does both in one call, for
a rollback that cannot wait for a review. History is not rewritten: publishing a
restored version adds a new version with the old steps, so the record still says
something else ran in between.

Restoring the version that is running is how unpublished changes are discarded.

## The builder

- Every saved rule autosaves, live ones included: a save writes the draft.
- The header shows the running version (`Active · v3`) and, when the draft
  differs from it, **Unpublished changes**; Publish reads **Publish changes**
  and is off while there is nothing to publish. A paused rule's reads **Publish
  and resume**.
- **Version history** lists the versions with **Restore** on each older one,
  and **Discard changes** when the draft differs. Restoring over unpublished
  changes asks first.

A node keeps its id across saves — the server keeps an id that is the rule's
own and stores the builder's `new-<uuid>` as the uuid — and the builder rebases
its pending edits when a save lands (`rebaseEdits`), dropping what the save
carried and keeping what was typed while it was in flight. Before this, every
save gave every node a new id, so an autosave closed the panel somebody was
typing into and lost the keystrokes after it.

## The backfill

`20261016210000_automation_rule_version_graphs` gave every rule that had been
published a version 1 holding exactly what it ran at the time — its node rows
and trigger columns — and pointed the rule at it. Until then the runner read
those directly, so no rule's behaviour changed; the running definition merely
became a row later edits cannot reach.

## The structured definition

The `/:ruleId/definition` routes (see [the rule tree](./automation-rule-tree.md))
keep their own draft as an `AutomationRuleVersion` with branches, under
`draftVersionId`. Their publish **compiles** that draft into the node shape
(`compileDefinition`) and stores it on the same version row before pointing
`publishedVersionId` at it, so a rule published either way runs what was
published. The next structured draft takes the next free version number, since
the builder publishes versions of its own in between.

The two editors do not share a draft. A rule published through the structured
routes shows unpublished changes in the builder until one of them publishes
again — which is the truth: the builder's draft is not what runs.

## Rule naming

`AutomationRuleNameMode` is `AUTO` or `MANUAL`. `AUTO` means the name is derived
from the trigger and re-derived when the trigger changes; `MANUAL` means
somebody typed it and it is never overwritten.

The migration defaults every existing rule to `MANUAL`, because each of their
names was typed by somebody and re-deriving one from its trigger would rename
their rule during a deployment.

## Not yet implemented

- Comparing two versions step by step. The history lists versions and restores
  them; it does not show what changed between two.
- Settings are not versioned. A rule's name, description and whether other
  rules may set it off (`allowChaining`) apply as soon as they are saved.

## Related

- [The structured rule model](./automation-rule-tree.md)
- [The REST surface](../api/automation-rules.md)
- [Loop protection](./automation-loop-protection.md)
- [The phased migration](../database/automation-rule-migration.md)
