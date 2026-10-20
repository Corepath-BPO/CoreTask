# Automation rules API

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId/automations`

Every route requires a bearer token and passes `WorkspaceMemberGuard`. The
workspace and project come from the verified route scope, never from the body —
see [authentication.md](authentication.md).

Reading requires membership. **Every write requires `MANAGER`**, enforced in
`AutomationsService.assertMayManage` rather than in the controller, so no
handler can forget it. Responses use the standard envelope,
`{ "success": true, "data": … }`.

This documents the surface as it exists. The builder edits a rule as an
`AutomationNode` tree — the **draft** — and publishing snapshots it into an
`AutomationRuleVersion`, which is what runs; see
[versioning](../architecture/automation-versioning.md). The structured model's
`/:ruleId/definition` routes are a second way to write the same rule, described
in [the rule tree](../architecture/automation-rule-tree.md).

## Endpoints

| Method   | Path                                  | Role    | Purpose                                   |
| -------- | ------------------------------------- | ------- | ----------------------------------------- |
| `GET`    | `/`                                   | member  | rules on this project, archived excluded  |
| `POST`   | `/`                                   | manager | create a rule — always as a `DRAFT`       |
| `GET`    | `/metadata`                           | member  | what the builder's forms may offer        |
| `GET`    | `/:ruleId/graph`                      | member  | the rule as nodes plus derived edges      |
| `POST`   | `/:ruleId/validate`                   | member  | check a graph without saving it           |
| `GET`    | `/:ruleId`                            | member  | one rule with its nodes                   |
| `PATCH`  | `/:ruleId`                            | manager | save the draft; `nodes` replaces it       |
| `POST`   | `/:ruleId/publish`                    | manager | validate, snapshot as a version, activate |
| `POST`   | `/:ruleId/pause`                      | manager | `status = PAUSED`                         |
| `POST`   | `/:ruleId/enable`                     | manager | publish again — validated, as publish is  |
| `GET`    | `/:ruleId/versions`                   | member  | published versions, newest first          |
| `GET`    | `/:ruleId/versions/:versionId`        | member  | one version, with its steps as a graph    |
| `POST`   | `/:ruleId/versions/:versionId/revert` | manager | put a version back in the draft           |
| `POST`   | `/:ruleId/duplicate`                  | manager | copy as a new draft                       |
| `DELETE` | `/:ruleId`                            | manager | archive if it has run, otherwise delete   |
| `GET`    | `/:ruleId/executions`                 | member  | runs, newest first, paged, with logs      |

`GET /metadata` is declared **before** `GET /:ruleId` in the controller, and has
to stay there. Nest matches in declaration order; the other way round,
`metadata` is parsed as a rule id and `ParseUUIDPipe` answers `400` for a route
that exists.

## `GET /`

Optional `?sectionId=` returns only the rules that belong under that section —
what the section's lightning icon lists, the way Asana's does.

A rule belongs to a section when the section is what it watches, read from the
rule itself by `rulesForSection` in `@coretask/contracts` rather than from a
column:

- its trigger is scoped to the section (`triggerConfig.sectionId`, or one of
  `sectionIds` for the any-of form), or
- one of its conditions checks `sectionId` is (or is one of) the section — the
  check a rule started from a section's lightning menu carries, and keeps when
  its trigger is later changed to something like "task completed".

Neither a negated form ("section is not…") nor an action that moves tasks to
the section counts: the first is about everywhere else, and the second is where
the rule sends things, not where it lives. The same helper drives the web
lightning, so the icon and the endpoint cannot disagree.

`ARCHIVED` rules are excluded. They exist to explain history, not to be
managed.

## `POST /`

```json
{
  "name": "Auto-assign incoming requests",
  "description": "…",
  "triggerType": "TASK_MOVED_TO_SECTION",
  "triggerConfig": { "sectionId": "019f…" },
  "nodes": []
}
```

`name` is 1–120 characters after trimming, `description` at most 500,
`triggerType` must be one of `AUTOMATION_TRIGGERS`, and `nodes` at most 50
entries.

**The rule is created as a `DRAFT` whatever status is requested.** `publish` is
the only path to `ACTIVE`, and it is the only place a rule is checked for being
able to run. A half-built rule saved straight to `ACTIVE` would start acting on
real tasks the moment it was saved.

Nodes are written through the same path an update uses. They were once inlined
here, which meant `create` quietly dropped positions and parentage while
`update` kept them: a rule came back flat on its first save and only held its
shape on the second.

## `GET /metadata`

Everything the forms need to offer real choices, answered from the project:

```json
{
  "triggers": [{ "subtype": "TASK_CREATED", "label": "When a task is created",
                 "description": "", "category": "Work item", "available": true }],
  "actions": [ … ],
  "conditionFields": [{ "field": "status", "label": "Status",
                        "valueKind": "ENUM", "options": [ … ] }],
  "sections": [{ "id": "019f…", "name": "Triage" }],
  "statuses": [{ "id": "019f…", "name": "In review", "colorToken": "violet" }],
  "priorities": [ … ],
  "members": [ … ],
  "customFields": [{ "id": "019f…", "name": "Severity", "type": "SINGLE_SELECT" }]
}
```

One endpoint rather than the builder assembling this from five. The old builder
hard-coded its condition fields and read sections from whatever the page
happened to have, so a form could offer a status the project does not define,
and a workspace that renamed its statuses saw somebody else's words.

Three things worth knowing about the response:

- `statuses` and `priorities` fall back to the legacy enums when the workspace
  has no definitions yet. A young project would otherwise get a "Status is…"
  condition with an empty list — a form that cannot be completed and a rule that
  can never match.
- `description` is always `""`. It used to repeat the label verbatim, which read
  as a stutter — "Assign a person / Assign a person" — and there is nothing
  useful to say yet.
- `available` is always `true`, because the endpoint returns only the executable
  set. Planned entries are not included; see
  [the action catalogue](../architecture/automation-action-catalog.md#the-convention-is-not-implemented-in-the-api).

## `GET /:ruleId/graph`

The same nodes as `GET /:ruleId`, plus the edges the canvas draws, plus the
rule's own header fields:

```json
{
  "id": "019f…", "projectId": "019f…", "name": "…", "description": null,
  "status": "ACTIVE", "version": 3, "allowChaining": true,
  "createdBy": { "id": "019f…", "name": "…", "email": "…", "avatarUrl": null },
  "publishedAt": "2026-08-01T09:12:00.000Z",
  "publishedVersion": { "id": "019f…", "version": 2, "isPublished": true, … },
  "hasUnpublishedChanges": true,
  "graph": { "nodes": [ … ], "edges": [ … ] },
  "createdAt": "…", "updatedAt": "…"
}
```

`graph` is the **draft**. `publishedVersion` is what runs (null until the first
publish), and `hasUnpublishedChanges` says whether the two differ — compared by
what each step is and where it sits, never by id, so a save that changed nothing
is not a change. The builder's header reads both.

**Edges are derived, never stored.** `parentNodeId` already says what an edge
row would say, and keeping both is how two answers to one question start
disagreeing. `deriveEdges` lives in `@coretask/validation` and is used by both
this response and the canvas, so the two cannot describe different connections.

`createdBy` is there because the rule settings panel shows who to ask about a
rule, and a rule nobody can be asked about is one nobody dares change.

A node whose stored position is exactly `(0, 0)` is treated as unplaced and laid
out by category. The columns are non-nullable with a zero default, so there is
no way to tell "never placed" from "placed at the origin" — and the origin is
not somewhere a person drags a node to.

## `POST /:ruleId/validate`

```json
{ "name": "…", "nodes": [ … ] }
```

Both optional; the stored rule is the fallback, so an empty body answers "is
what I saved publishable?".

```json
{
  "publishable": false,
  "issues": [
    {
      "level": "ERROR",
      "nodeId": "019f…",
      "path": "sectionId",
      "message": "That section is no longer in this project."
    },
    {
      "level": "WARNING",
      "nodeId": "019f…",
      "path": null,
      "message": "This action can set off the same trigger again."
    }
  ]
}
```

`publishable` is false when any issue is an `ERROR`. Warnings never block.

This asks exactly the question Publish asks, so the builder can explain why
Publish is unavailable before anybody presses it. The structural half of the
check (`validateGraphStructure`) is in `@coretask/validation` and runs in the
browser too — no round trip per keystroke, and no chance of the two disagreeing
about what "valid" means. The half that needs the database — does the section
still exist, is the member still here, does the status belong to this project —
can only run here.

Returns `200`, not `422`. A rule that is not ready is the expected answer to
this question, not an error.

## `PATCH /:ruleId`

Any of `name`, `description`, `allowChaining`, `triggerType`, `triggerConfig`,
`nodes`.

**This writes the draft.** A published rule goes on running the version it was
published with until `publish` is called again, so a builder may save a live
rule as often as it likes — the web builder autosaves every saved rule.

**Supplying `nodes` replaces every node** and increments `version` (a count of
draft saves, not a version number). They are not diffed. A builder sends the
canvas as it now stands, and reconciling that against stored rows means guessing
which node is "the same" one — guessing wrong silently rewires a rule. Omitting
`nodes` leaves the canvas untouched.

A node keeps its id from one save to the next when the id is one of this rule's
own nodes, and a `new-<uuid>` id from the builder is stored as that uuid. Any
other id — another rule's node, or a name like `"t"` — is given a fresh one, so
a caller cannot claim a row it does not own by naming it. `parentId` is resolved
through the same mapping, so parentage round-trips within one save.

When `nodes` includes a trigger and the request does not set `triggerType` or
`triggerConfig` explicitly, both are **derived from the trigger node**: the
rule's trigger columns describe the draft's trigger, and a builder that saved a
changed trigger as part of the canvas would otherwise publish a version with the
old one. An explicit value still wins. What a live rule listens for is the
published version's trigger, which changes only on `publish`.

## `POST /:ruleId/publish`

Validates the draft, then snapshots it — its nodes and trigger — as the next
`AutomationRuleVersion`, points `publishedVersionId` at it, sets
`status = ACTIVE` and stamps `publishedAt`. A draft identical to the version
already running (a second press, a resume) points back at that version instead
of adding a copy to the history. Two publishes racing for the same version
number get `409` for the loser. Refuses a rule that:

- names a trigger the engine does not understand
- has no action at all
- names an action the engine cannot run
- has an action missing the setting it cannot run without — a move with no
  section, an assignment with nobody named, a comment with no text
- watches a section that no longer exists

Each of those otherwise fails **silently at run time**. A rule with no action
does nothing, one naming a deleted section never matches, and an unrunnable
action would report success for something that never happened.

All problems come back at once, so a builder can show them together:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "This rule is not ready to publish.",
    "details": {
      "problems": [
        "Add at least one action — a rule with none would do nothing.",
        "The section this rule watches no longer exists."
      ]
    }
  }
}
```

Note that `publish` runs `AutomationsService.validate`, a shorter list than
`POST /:ruleId/validate` runs. The endpoint is the more thorough of the two.

## `POST /:ruleId/pause` and `/enable`

`pause` sets the status and nothing else. Pausing keeps the definition, which is
what makes stopping a misbehaving rule safe and instant — only `ACTIVE` rules
run, and every other status is a rule that exists and does nothing.

`enable` is `publish`: a rule may have gone stale while it was off (a deleted
section, a member who left), so it is validated again. Unchanged, it goes back
to the version it ran before.

## `GET /:ruleId/versions` and `/versions/:versionId`

Published versions, newest first:

```json
[
  {
    "id": "019f…",
    "version": 2,
    "name": "Assign on arrival",
    "triggerType": "TASK_MOVED_TO_SECTION",
    "publishedAt": "…",
    "publishedBy": { "id": "…", "name": "…", "avatarUrl": null },
    "isPublished": true,
    "stepCount": 3
  }
]
```

`name` is what the rule was called when that version was published. The single
version adds `triggerConfig` and `graph` — its steps, laid out as `/graph` lays
out a rule. A draft the structured endpoints are still editing has no steps of
this kind and is not listed. `404` for a version of another rule.

## `POST /:ruleId/versions/:versionId/revert`

```json
{ "publish": false }
```

Copies the version's nodes and trigger into the draft and answers with the rule
as `GET /:ruleId` does. Nothing running changes: the restored steps are
published by `publish`, validated against the project as it is now. With
`"publish": true` it publishes in the same call and is refused exactly as
`publish` is. History is not rewritten — publishing a restored version adds a
new version with the old steps.

Restoring the version that is running is how a draft's unpublished changes are
discarded.

## `POST /:ruleId/duplicate`

Copies the rule and its nodes as a new `DRAFT` named `"<name> copy"`.

Always a draft: duplicating a live rule and having both fire immediately is
never what anyone means by "duplicate".

The copy keeps the graph's shape — parentage, arms and order — through the same
writer a save uses. It copies the draft, which for a live rule may differ from
what is running.

## `DELETE /:ruleId`

```json
{ "deleted": false, "archived": true }
```

A rule that has run (`runCount > 0`) or has ever been published is archived; a
draft that has never run is deleted. Always `200` with the outcome, so a client
can tell which happened.

A rule that has run is part of the record of why tasks look the way they do —
its executions reference it, and deleting it would take that history with them.
A draft has no history to lose.

## `GET /:ruleId/executions`

Runs, newest first, each including its `AutomationExecutionLog` rows in the
order they were written. Paged with `page` and `limit` (default 25, at most
100); the data is the array of runs and the envelope's `meta` carries
`{ page, limit, total, totalPages }`, so a caller that never asks for a page
gets the same 25 it always did. Runs that started in the same instant are
ordered by id, so none appears on two pages. **Run history** in the web app
shows the newest 25 and loads older ones with **Show older runs**.

| Status             | Meaning                                        |
| ------------------ | ---------------------------------------------- |
| `RUNNING`          | started, not finished                          |
| `COMPLETED`        | every action succeeded                         |
| `PARTIALLY_FAILED` | some failed; the logs say which                |
| `FAILED`           | every action failed                            |
| `SKIPPED`          | conditions did not hold, or a guard stopped it |

`SKIPPED` is deliberately not `FAILED`. A rule that does not apply has not gone
wrong, and a history that conflates the two is useless for diagnosis.

Each log row carries `succeeded`, a `message`, and `beforeValue`/`afterValue`,
because a rule with four actions where the third failed is only diagnosable if
each is accounted for separately. A step a cap cut off has a row of its own
saying it was not run and why; see
[loop protection](../architecture/automation-loop-protection.md).

Each run carries `ruleVersion: { version }` — the version it executed — so an
old run reads against what the rule said then. Null for runs from before
versions were kept.

## The rule library

Base: `/api/v1/workspaces/:workspaceId/automation-templates`

Rules saved to be started from again, in any project of the workspace. A
template is a **snapshot** of a rule's graph, not a link to the rule: editing,
archiving or deleting the rule afterwards leaves the template as it was saved.
Workspace-scoped rather than under a project, because reuse across projects is
the whole point — that is the difference between this and `duplicate`, which
copies a rule beside itself.

| Method   | Path                 | Role    | Purpose                                   |
| -------- | -------------------- | ------- | ----------------------------------------- |
| `GET`    | `/`                  | member  | every template, with its graph, by name   |
| `POST`   | `/`                  | manager | save a rule's current graph as a template |
| `PATCH`  | `/:templateId`       | manager | rename or describe                        |
| `DELETE` | `/:templateId`       | manager | remove; drafts started from it are kept   |
| `POST`   | `/:templateId/apply` | manager | start a `DRAFT` in a project from it      |

### `POST /`

```json
{ "projectId": "…", "ruleId": "…", "name": "Standard triage", "description": "…" }
```

Addressed by rule rather than by graph, so the library only ever holds things
that were built in the builder. `name` and `description` default to the rule's
own. The rule must have at least one node.

`clearReferences: true` saves the rule with its sections, statuses, fields and
options left blank, so the template asks for them wherever it is used instead of
carrying this project's and matching by name. It is the same translation an
apply performs when nothing matches, run against an empty project. People and
priorities are workspace-wide and stay either way.

Alongside the graph, the service records the **names** behind every
project-scoped id the rule carries — sections, statuses, custom fields and their
options — in a `references` column the response does not expose. Members and
priorities are workspace-wide and need no such record.

### `POST /:templateId/apply`

```json
{ "projectId": "…", "sectionId": "…" }
```

Creates a `DRAFT` in `projectId`, never a live rule, and answers with
`{ rule, unresolved }` — the rule exactly as `GET /automations/:ruleId` returns
it. Every project-scoped id in the graph is translated, each kind the same way:

1. **kept** if the target project has that very row (a template applied back
   where it came from, or a field the workspace library shares);
2. otherwise **matched by name**, case-insensitively, against the target
   project's sections, its statuses (its own set, or the workspace defaults when
   it has none) and the fields linked to it — a select option is then matched
   by label on the matched field;
3. otherwise **cleared** and reported in `unresolved` as
   `{ nodeType, subtype, kind, name }`, where `kind` is `SECTION`, `STATUS`,
   `CUSTOM_FIELD` or `OPTION` and `name` is what the source project called it.

A condition about a field the project lacks is emptied entirely, so the builder
shows it as an unanswered row rather than a comparison against nothing. Nothing
is refused for failing to match: the draft cannot publish until the blanks are
filled, because `publish` refuses an action missing its setting — that is the
check.

`sectionId`, when given, must belong to `projectId` and replaces the section a
`TASK_MOVED_TO_SECTION` trigger remembered; it is how a template started from a
section's lightning menu watches that section. `useCount` and `lastUsedAt` on
the template are updated.

`404` for a template, project or section outside the workspace — the same rule
as everywhere else: an id from elsewhere is indistinguishable from one that does
not exist.

## Errors

| Status | When                                                                 |
| ------ | -------------------------------------------------------------------- |
| `400`  | a malformed uuid in the path, or a rule that is not ready to publish |
| `409`  | two publishes of one rule at the same moment                         |
| `401`  | missing or invalid access token                                      |
| `403`  | not a member, or not a `MANAGER` for a write                         |
| `404`  | `RESOURCE_NOT_FOUND` — no such rule **in this project**              |

`404` covers a rule that exists in another project or workspace. A
distinguishable "exists but forbidden" would confirm the id is real.

## Not yet available

- Branches, condition groups or actions as resources of their own; the
  structured model is read and written whole through `/:ruleId/definition`.
- Planned actions in the metadata response.

## Related

- [The automation engine](../architecture/automation-engine.md)
- [Loop protection](../architecture/automation-loop-protection.md)
- [Versioning](../architecture/automation-versioning.md)
