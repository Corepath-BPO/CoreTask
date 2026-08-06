# Automation rules API

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId/automations`

Every route requires a bearer token and passes `WorkspaceMemberGuard`. The
workspace and project come from the verified route scope, never from the body —
see [authentication.md](authentication.md).

Reading requires membership. **Every write requires `MANAGER`**, enforced in
`AutomationsService.assertMayManage` rather than in the controller, so no
handler can forget it. Responses use the standard envelope,
`{ "success": true, "data": … }`.

This documents the surface as it exists. The structured rule model
([versions, branches, condition groups](../architecture/automation-rule-tree.md))
has tables but no endpoints; every route below reads and writes the
`AutomationNode` tree.

## Endpoints

| Method   | Path                  | Role    | Purpose                                   |
| -------- | --------------------- | ------- | ----------------------------------------- |
| `GET`    | `/`                   | member  | rules on this project, archived excluded  |
| `POST`   | `/`                   | manager | create a rule — always as a `DRAFT`       |
| `GET`    | `/metadata`           | member  | what the builder's forms may offer        |
| `GET`    | `/:ruleId/graph`      | member  | the rule as nodes plus derived edges      |
| `POST`   | `/:ruleId/validate`   | member  | check a graph without saving it           |
| `GET`    | `/:ruleId`            | member  | one rule with its nodes                   |
| `PATCH`  | `/:ruleId`            | manager | update; `nodes` replaces the whole canvas |
| `POST`   | `/:ruleId/publish`    | manager | validate and activate                     |
| `POST`   | `/:ruleId/pause`      | manager | `status = PAUSED`                         |
| `POST`   | `/:ruleId/enable`     | manager | `status = ACTIVE`                         |
| `POST`   | `/:ruleId/duplicate`  | manager | copy as a new draft                       |
| `DELETE` | `/:ruleId`            | manager | archive if it has run, otherwise delete   |
| `GET`    | `/:ruleId/executions` | member  | the last 25 runs, with per-action logs    |

`GET /metadata` is declared **before** `GET /:ruleId` in the controller, and has
to stay there. Nest matches in declaration order; the other way round,
`metadata` is parsed as a rule id and `ParseUUIDPipe` answers `400` for a route
that exists.

## `GET /`

Optional `?sectionId=` returns only rules whose trigger watches that section.

The filter reads the trigger configuration —
`triggerConfig: { path: ['sectionId'], equals: sectionId }` — rather than a
column. The section a rule watches is part of how it triggers, not a second
relationship, and a denormalised column would eventually disagree with the
trigger it was copied from.

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
  "graph": { "nodes": [ … ], "edges": [ … ] },
  "createdAt": "…", "updatedAt": "…"
}
```

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

**Supplying `nodes` replaces every node** and increments `version`. They are not
diffed. A builder sends the canvas as it now stands, and reconciling that
against stored rows means guessing which node is "the same" one — guessing wrong
silently rewires a rule. Omitting `nodes` leaves the canvas untouched.

Node ids sent by the client are mapped to fresh database ids within the write,
and `parentId` is resolved through that map. A caller therefore cannot smuggle
in a row it does not own by naming its id, and parentage still round-trips
within one save.

When `nodes` includes a trigger and the request does not set `triggerType` or
`triggerConfig` explicitly, both are **derived from the trigger node**. Those
columns are a denormalisation of the graph — they are how the runner finds
candidate rules — and a builder that saved a changed trigger as part of the
canvas would otherwise leave the rule showing one trigger and firing on another.
An explicit value still wins.

This is also the only save path. There is no separate draft endpoint, so a
`PATCH` against a published rule changes what it does immediately; see
[versioning](../architecture/automation-versioning.md).

## `POST /:ruleId/publish`

Validates, then sets `status = ACTIVE` and stamps `publishedAt`. Refuses a rule
that:

- names a trigger the engine does not understand
- has no action at all
- names an action the engine cannot run
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

Both set a status and nothing else. Pausing keeps the definition, which is what
makes stopping a misbehaving rule safe and instant — only `ACTIVE` rules run,
and every other status is a rule that exists and does nothing.

## `POST /:ruleId/duplicate`

Copies the rule and its nodes as a new `DRAFT` named `"<name> copy"`.

Always a draft: duplicating a live rule and having both fire immediately is
never what anyone means by "duplicate".

The copy does **not** preserve parentage — `duplicate` copies `nodeType`,
`subtype`, `configuration` and `position` only. A branched rule duplicates into
a flat one, which the runner will then evaluate with flat semantics. Worth
knowing before relying on it.

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

The 25 most recent runs, newest first, each including its
`AutomationExecutionLog` rows in the order they were written.

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
each is accounted for separately.

The limit is fixed at 25 in the service and is not exposed as a query
parameter.

## Errors

| Status | When                                                                 |
| ------ | -------------------------------------------------------------------- |
| `400`  | a malformed uuid in the path, or a rule that is not ready to publish |
| `401`  | missing or invalid access token                                      |
| `403`  | not a member, or not a `MANAGER` for a write                         |
| `404`  | `RESOURCE_NOT_FOUND` — no such rule **in this project**              |

`404` covers a rule that exists in another project or workspace. A
distinguishable "exists but forbidden" would confirm the id is real.

## Not yet available

- Any endpoint for the structured model: no versions, branches, condition groups
  or actions as resources.
- A draft-save endpoint. `PATCH` writes the live definition.
- Version history or revert.
- Pagination on executions.
- A manual "run this rule now" trigger.
- Planned actions in the metadata response.

## Related

- [The automation engine](../architecture/automation-engine.md)
- [Loop protection](../architecture/automation-loop-protection.md)
- [Versioning](../architecture/automation-versioning.md)
