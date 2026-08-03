# Backend architecture

NestJS 11 on Express 5, TypeScript in strict mode, compiled to CommonJS.

## Layering

```
src/
├── main.ts / worker.ts      entry points; load env before anything else
├── bootstrap/               createApp() — middleware, pipes, filters, Swagger
├── config/                  env schema + typed AppConfigService
├── common/                  cross-cutting: filters, guards, interceptors, DTOs
├── database/                PrismaService
├── redis/                   RedisService (also supplies BullMQ's connection)
├── modules/                 domain modules (controller → service → Prisma)
├── integrations/            outbound systems: email, storage, notifications
├── jobs/                    BullMQ queues (producers) and processors (consumers)
└── websocket/               Socket.IO gateway
```

Rules that shape the code:

- **Controllers are thin.** They bind HTTP to a service call and declare Swagger
  metadata. No business logic, no Prisma.
- **Services own the logic** and are the only layer that touches Prisma. There is
  no repository layer, because there is currently nothing for it to abstract —
  Prisma's client already is the data-access seam.
- **Modules stay focused** and import what they need explicitly. The only global
  modules are configuration, Prisma, Redis, jobs and the websocket gateway.

## Workspace-scoped resources

Projects, sections, tasks and tickets all mount under
`workspaces/:workspaceId/...` behind `WorkspaceMemberGuard`. Reads are open to
any member; `MEMBER` creates and edits; `MANAGER` archives, because archiving
hides work from everyone.

Tasks and tickets are scoped to the workspace rather than nested under a project
because both can exist without one, and both are read across projects — "my
tasks" and the triage queue. Project is a filter, not a parent.

### Invitations

An invitation is addressed to an **e-mail**, not a user, because the point is to
reach people who have not signed up. Only the SHA-256 of the token is stored —
same reasoning as refresh tokens: the raw value exists in one e-mail link, and a
database leak must not be replayable. Nothing can re-read a token, so "resend"
necessarily issues a new one.

Redeeming cannot live under `/workspaces/:workspaceId`. The holder is not a
member yet, so `WorkspaceMemberGuard` would turn them away from the very route
that would make them one; the token names the workspace instead. The preview is
`@Public()` so the page can say _which_ workspace is inviting before offering a
sign-in — and is deliberately thin, exposing nothing but the workspace name, the
invited address, the role and who sent it.

Three rules carry most of the weight:

- **The role ceiling.** `canGrantRole` refuses anything above the inviter's own
  rank, so privilege escalation is not one invitation away, and refuses `OWNER`
  outright because ownership is a transfer rather than something granted by
  surprise. The rule lives in `@coretask/contracts`, so the picker offers
  exactly what the API accepts — but the API is the boundary.
- **The address must match on accept.** Otherwise a forwarded e-mail hands the
  workspace to whoever opens it, and the invitation stops being a statement
  about _who_ was invited.
- **One live offer per address.** `@@unique([workspaceId, email])` and an upsert
  mean re-inviting refreshes the row, which makes "resend" and "change the role
  before they accept" the same operation — and stops a revoked link surviving
  next to a fresh one.

Unknown, revoked, spent and expired tokens all return the same 404, so the
endpoint cannot be used to probe for which links once existed. Accepting writes
the membership and marks the invitation used in one transaction, so a crash
cannot leave a consumed token that granted nothing.

### Ticket keys

`Workspace.ticketCounter` is incremented **inside the ticket-creation
transaction**. The `UPDATE ... increment` takes a row lock on the workspace, so
concurrent reporters serialise there instead of both reading the same counter and
racing to insert the same key. That is what makes numbering gapless and
collision-free; `@@unique([workspaceId, number])` is the backstop, not the
mechanism.

The counter must never move backwards. The dev seed re-runs on every container
start and used to reset it to a fixed value, walking it behind tickets reported
since — the next report then collided with an existing key. It now takes the
maximum of the seeded count and the highest existing number.

### Derived timestamps

`resolvedAt` and `closedAt` are computed from `status`, never accepted from the
client — the same pattern as `completedAt` on tasks and projects. Closing implies
resolution, so a ticket closed without passing through `RESOLVED` still gets a
resolution timestamp; otherwise time-to-resolve reporting would silently miss it.
Reopening clears both.

### Comments

A comment hangs off a task _or_ a ticket, modelled as two nullable foreign keys
rather than a `(entityType, entityId)` pair. That keeps real referential
integrity and lets the parent's delete cascade do its job; the cost is that
"which parent" is a branch in one place, `CommentsService.resolveTask` /
`resolveTicket`, rather than a lookup table.

Routes follow the same split as the model:

| Route                                   | Why                                             |
| --------------------------------------- | ----------------------------------------------- |
| `…/tasks/:taskId/comments`              | Reading and posting is what a thread is         |
| `…/tickets/:idOrKey/comments`           | Same, and keys work here too                    |
| `…/comments/:commentId` (PATCH, DELETE) | A comment id is unique; the parent adds nothing |

Both parents are resolved through `TasksService.requireTask` and
`TicketsService.requireTicket`, which are workspace-scoped. That is what stops a
comment being attached to — or read from — another tenant's work, without the
rule being restated per route.

Permissions are deliberately asymmetric. **Editing is author-only**, including
for owners: rewriting what someone else said is not a moderation power.
**Deleting** is author-or-`MANAGER`, and a manager deleting someone else's
comment writes an activity line naming who did it. Authors deleting their own do
not, because that is not an event anyone needs to audit.

Deletion is soft. Activity entries point at the comment row, and a dangling
reference in an audit trail is worse than a row nothing renders. Every endpoint
treats a soft-deleted comment as absent, including edit, which 404s.

Notifications go to everyone already involved: the assignee, the reporter or
creator, and anyone who has commented before. Replying is how you join a thread
— without that last group a two-person conversation goes silent for whichever of
them is not the assignee. Recipients are a `Set`, so someone who is reporter,
assignee and prior commenter is notified once, and the actor is always removed.

### Mentions

A mention lives **in the comment text**, as `@[Ada Lovelace](uuid)`, not as a
list of ids sent alongside a plain body. The format is defined once in
`@coretask/contracts` so the composer, the renderer and the API parser cannot
drift apart.

Storing it in the text is what makes editing honest: deleting the token deletes
the mention, and there is no second list to fall out of sync with what the
comment actually says. `CommentMention` is a derived index over that text,
rebuilt on every write, so "who do I notify" and a future "what mentions me" are
joins rather than a scan with a regex.

The server parses the body itself and keeps only current workspace members. That
is the security property: a client cannot claim to have mentioned someone it did
not, and so cannot use mentions to notify people at will.

Two edge cases decide the shape of the rest:

- **A member who has left** is dropped from the index rather than rejected.
  Erroring would make any older comment naming them permanently uneditable,
  which is worse than a mention that quietly stops resolving. The token stays in
  the text, so the renderer still shows the name it was written with.
- **Editing** notifies only the people the edit _added_. Comparing against the
  previous index is what stops a typo fix re-pinging everyone already named.

Being named is a stronger signal than being subscribed, so it sends `MENTIONED`
and suppresses the generic `COMMENT_CREATED` for those recipients — one comment
never arrives twice. Notification bodies run through `stripMentionTokens`,
because a notification is plain text and `@[Ada](uuid)` is markup.

### List rollups

List endpoints return a `summary` in `meta` computed over the whole workspace,
not the returned page and not the caller's status filter. The tiles answer "how
is the queue doing?", which must not change shape because someone filtered the
list below them to one status.

## Configuration

`config/env.schema.ts` is a Zod schema covering every variable. `getEnv()` parses
`process.env` once and freezes the result; `AppConfigService` exposes it as a
typed, structured object.

Nothing outside `config/` reads `process.env`.

Two properties matter:

1. **Fail fast.** `main.ts` validates before Nest bootstraps, so a misconfigured
   deploy dies with a list of offending variables rather than a dependency-
   injection stack trace.
2. **Refuse unsafe production values.** When `NODE_ENV=production` the schema
   rejects the placeholder secrets from `.env.example`, identical access and
   refresh secrets, and `SameSite=None` without HTTPS.

## The response envelope

Every success is wrapped by `ResponseInterceptor`:

```json
{ "success": true, "data": {}, "meta": null }
```

Controllers return plain domain objects. Returning a `PaginatedResult` lifts the
page information into `meta`:

```json
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }
```

Every failure is rendered by `AllExceptionsFilter`:

```json
{ "success": false, "error": { "code": "RESOURCE_NOT_FOUND", "message": "…", "details": null } }
```

`code` comes from `@coretask/contracts` and is what clients branch on; `message`
is human-facing copy that may change. The filter also translates infrastructure
errors into stable codes — Prisma `P2002` becomes `409 RESOURCE_CONFLICT`, `P2025`
becomes `404 RESOURCE_NOT_FOUND`, throttler rejections become
`429 RATE_LIMIT_EXCEEDED`. In production, 5xx messages are replaced with generic
copy and the real error is logged, never returned.

## Guards

`JwtAuthGuard` is registered as a global `APP_GUARD`, so **authentication is the
default**. An anonymous endpoint must opt out with `@Public()` — which makes an
accidentally unprotected route hard to write.

The JWT strategy re-reads the user on every request. A 15-minute access token
would otherwise keep working after an account is disabled; one indexed
primary-key lookup is a fair price for closing that window.

`WorkspaceMemberGuard` protects any route with a `:workspaceId` parameter. It
resolves membership, enforces `@RequireWorkspaceRole(...)`, and attaches the
result to the request. Note that guards run _before_ pipes, so it validates the
UUID shape itself — otherwise a malformed id would reach PostgreSQL as a uuid
comparison and surface as a 500 instead of a 400.

## Validation

HTTP DTOs use class-validator with `whitelist` and `forbidNonWhitelisted`, so an
unexpected property is a `422`, not a silently ignored field.

Both the DTOs and the client's Zod schemas read their bounds from
`@coretask/contracts` (`PASSWORD_MIN_LENGTH`, `WORKSPACE_SLUG_PATTERN`, …), so
the two validation layers cannot drift apart.

## Jobs and the worker

`WorkerModule` shares the API's codebase but registers processors instead of
controllers. It runs as a separate container from the same image with a different
entry point, so the two scale independently.

`RUN_MIGRATIONS=false` on the worker: two processes racing `prisma migrate
deploy` on start would contend on the advisory lock.

## Graceful shutdown

`app.enableShutdownHooks()` lets Nest run `onModuleDestroy` on SIGTERM, which
disconnects Prisma and quits Redis. The worker additionally waits for BullMQ to
drain before the process exits, so a rolling deploy does not abandon in-flight
jobs.

## Testing

| Suite       | Command         | Needs infrastructure |
| ----------- | --------------- | -------------------- |
| Unit        | `pnpm test`     | No                   |
| Integration | `pnpm test:e2e` | PostgreSQL + Redis   |

The e2e suite boots the **real** application through `createApp()` — the same
pipes, guards, filters and interceptors production runs — because that stack is
exactly where the envelope and tenant isolation live. A trimmed-down testing
module would prove nothing about either.

It runs against a dedicated `coretask_e2e` PostgreSQL _schema_, so truncation
between specs can never reach development data.

`test/unit/enum-parity.spec.ts` asserts that the enums in `@coretask/contracts`
still match Prisma's. The shared package cannot import Prisma, so the enums are
declared twice; this test is what stops them diverging.
