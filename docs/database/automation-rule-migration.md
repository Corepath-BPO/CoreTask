# Migrating automation rules to the structured model

The `AutomationNode` tree is live data with rules running against it. Replacing
it with the structured model
([trigger + ordered branches](../architecture/automation-rule-tree.md)) is
phased, and every phase is reversible until the last one.

## The migrations

| Migration                                    | What it did                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `20260804211005_add_automation`              | `automation_rules`, `automation_nodes`, `automation_executions`, `automation_execution_logs` |
| `20260807120000_automation_allow_chaining`   | `automation_rules.allowChaining`, `NOT NULL DEFAULT true`                                    |
| `20260807160000_automation_structured_rules` | five new tables, three enums, three columns on `automation_rules`                            |

Both of the later two are **purely additive**. Nothing is dropped, no column
changes type, and no existing row is rewritten. That is the property that makes
their rollback trivial, and it was chosen over a cleaner end state on purpose.

### `allowChaining`

```sql
ALTER TABLE "automation_rules"
  ADD COLUMN "allowChaining" BOOLEAN NOT NULL DEFAULT true;
```

Defaulted to `true` so every rule that exists keeps behaving exactly as it does
today. The column records an intent that was previously unexpressible; it does
not change what any current rule means. A default of `false` would have been a
silent behaviour change for every rule in every workspace, delivered as a schema
migration.

### `automation_structured_rules`

Creates `AutomationRuleNameMode`, `AutomationBranchType` and
`ConditionGroupOperator`; then `automation_rule_versions`,
`automation_branches`, `automation_condition_groups`, `automation_conditions`
and `automation_actions`; then adds `nameMode`, `draftVersionId` and
`publishedVersionId` to `automation_rules`.

Two choices in it are worth reading twice.

**`nameMode` defaults to `MANUAL`.** Every rule that already exists was named by
somebody typing. Defaulting to `AUTO` would re-derive those names from their
triggers on first save — a mass rename nobody asked for, arriving with a
deployment.

**The rule's version pointers are `ON DELETE SET NULL`, not `CASCADE`.**
Everything below a version cascades — branches, groups, conditions, actions —
because they have no meaning apart from it. But the pointers _up_ from the rule
must not: losing a version must not delete the rule that points at it. A rule
with no draft is recoverable; a rule that vanished is not.

## The four phases

From [the anchor document](../architecture/asana-parity-rule-builder.md). No
step deletes anything another step still needs.

### Phase 1 — read both

New tables land alongside `automation_nodes`. Nothing is dropped, nothing is
backfilled, and the runner is untouched.

**Rollback:** drop the five tables and the three columns. No rule is affected,
because nothing reads them.

**Status: done, at the schema level only.** The tables exist. No application
code reads or writes them — grep `api/src`, `web/src` and `packages` for
`automationRuleVersion`, `automationBranch` or `publishedVersionId` and you get
nothing. Phase 1 is complete in the sense that the storage is available; the
"read both" adapter that its name implies has not been written.

### Phase 2 — backfill

Every existing rule gets an `AutomationRuleVersion` built from its node tree:

| From the node tree                             | To the structured model                             |
| ---------------------------------------------- | --------------------------------------------------- |
| the `TRIGGER` node's subtype and configuration | `version.triggerType` / `triggerConfig`             |
| flat `CONDITION` nodes                         | the `PRIMARY` branch's `ALL` group, in order        |
| flat `ACTION` nodes                            | the `PRIMARY` branch's actions, in `position` order |
| a `BRANCH` node's `match` arm                  | the current branch's actions                        |
| a `BRANCH` nested in the previous `else` arm   | the next `OTHERWISE_IF`, in chain order             |
| an `else` arm holding only actions             | the `OTHERWISE` branch                              |

The backfilled version becomes both the draft and the published version for a
rule that is `ACTIVE`; a rule that has never been published gets a draft only.

**Rollback:** delete the version rows. The node tree is still the source of
truth and is still what executes, so deleting a bad backfill costs nothing but
the time to run it again. This is the phase to re-run as many times as it takes.

**Status: not written.** There is no backfill command.

### Phase 3 — edit structured only

The builder writes versions. The node tree stops being written.

This is the first phase with a one-way component. From the moment writes stop,
`automation_nodes` begins to go stale: a rule edited after the cut-over has a
current version and an out-of-date tree.

**Rollback:** revert the application, and every rule edited since the cut-over
reverts with it — to its pre-cut-over definition, silently. The mitigation is to
keep writing the tree through phase 3 as a shadow write, so the rollback
position stays "revert the code" rather than "revert the code and lose the last
day of edits". Whether that is worth the double write is the decision this phase
turns on; a phase 3 that skips it must be short and announced.

### Phase 4 — execute structured, verify, then remove

The runner reads the published version. Only after a verification window do the
legacy columns go.

The verification window is not a formality. Until the structured runner has run
against real traffic, the only evidence that the backfill preserved meaning is
the backfill's own tests — and the failure mode is a rule that quietly does
something slightly different, which nobody reports because nobody is watching
that rule.

**Rollback before the drop:** point the runner back at the node tree. Both
models are still present and this is a configuration change.

**Rollback after the drop:** restore from a dump. Migrations here are
forward-only; there is no down migration, and `automation_nodes` is the only
record of the pre-migration shape.

That is survivable only because the drop is the last thing that happens, after
the window, and never in the same deployment as the runner cut-over.

## Where the rollback line sits

| Phase                      | Reversible by                    | Data at risk                                |
| -------------------------- | -------------------------------- | ------------------------------------------- |
| 1                          | dropping the new tables          | none                                        |
| 2                          | deleting the backfilled versions | none                                        |
| 3                          | reverting the application        | edits since cut-over, unless shadow-written |
| 4a (runner reads versions) | configuration change             | none                                        |
| 4b (legacy dropped)        | restoring from a dump            | everything since the dump                   |

Phase 4b is the only irreversible step in the sequence, and it is deliberately
the last and the smallest.

## Verification

**None has been run.** This document does not have a verification section
comparable to
[the custom field migration's](./custom-field-migration.md#verification-run),
because the backfill it would verify does not exist yet.

When it does, the shape to follow is the one that migration used: a scratch
database, every migration up to but excluding this one, representative legacy
rows, then the backfill, then a count comparison. The counts that matter here:

- one version per rule, and one branch per alternative the tree expressed
- action counts per branch matching the node tree's arms
- condition counts per group matching the tree's conditions
- every `OTHERWISE` last in its version, and at most one per version
- no rule left with a null `publishedVersionId` that was `ACTIVE` beforehand

The last one is the check that catches a backfill that silently skipped rules,
which is the failure that would otherwise be discovered by a rule not running.

The structural invariants are worth asserting in the backfill itself, with
`RAISE EXCEPTION` inside the transaction, rather than in a test afterwards —
because nothing in the schema enforces them. See
[the branch invariants](../architecture/automation-branches.md#what-actually-enforces-them).

## Related

- [The rule builder rebuild](../architecture/asana-parity-rule-builder.md)
- [The structured rule model](../architecture/automation-rule-tree.md)
- [Versioning](../architecture/automation-versioning.md)
- [The custom field migration](./custom-field-migration.md) — the pattern this follows
