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

### Managing members

Reading the roster is open to any member — you cannot collaborate with people
you cannot see. Changing it is not, and the rules live in `MembersService`
rather than in a role decorator, because every one of them depends on the
_target's_ current role as well as the caller's, which a decorator cannot know.

`canManageMember` is **strictly greater**, not "at least". That single choice
does three jobs at once: peers cannot demote or eject one another (otherwise two
admins race to remove each other and whoever clicks first keeps the workspace),
nobody can act on themselves, and the owner is untouchable — all without a
special case for any of them.

Ownership is the exception that shapes the rest. It can never be assigned
through a role change, only through `transfer-ownership`, which is owner-only
and demotes the outgoing owner to `ADMIN` rather than removing them — dropping
someone out of a workspace they built, with no undo, is not a reasonable
consequence of handing over a title. Both writes share a transaction, so the
workspace never has two owners or none. The owner also cannot be removed or
leave, because a workspace with no owner has nobody left who could transfer it.

**Removal unassigns their open work.** Assignment points at a `User`, not a
`WorkspaceMember`, so nothing in the schema clears it — the board would go on
showing work assigned to someone who can no longer open it. The unassignment
shares the transaction with the deletion so the two can never disagree. Only
_open_ work: a finished task records who did it, and rewriting that would
falsify history, which is also why comments and reported tickets stay.

Access ends immediately rather than at the next token expiry, because
`WorkspaceMemberGuard` resolves membership per request.

`MembersService` is deliberately a separate module from `WorkspaceMembersService`.
The latter backs the guard that every workspace route depends on; folding these
operations into it would make the guard's module pull in activity logging and
notifications, and since the notifications module is itself guarded, that closes
a dependency cycle.

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

An invitation may also name a **team**, so somebody arrives already on the one
they were hired for instead of needing a second action nobody remembers to take.
The team joins inside that same transaction — doing it afterwards would leave a
window where they are in the workspace but not the team, and a failure there
would strand them, because the invitation is spent by then. `teamId` is
`SetNull`: deleting a team must not invalidate a live invitation, since the
workspace membership is the part that matters. Acceptance re-checks the team
against the workspace rather than trusting what was written when the invitation
was sent.

The preview gained exactly one field, `teamName`. A name sits on the same footing
as the role — material to deciding whether to accept, and silent about the
workspace's people. `invitations.e2e-spec.ts` asserts the preview's key set
exhaustively, so widening it further has to be a deliberate edit rather than
something that leaks out with the next field on the model.

### Outbound e-mail

Three transports, chosen in this order by `EmailService`:

1. **Microsoft Graph**, when the `MICROSOFT_GRAPH_*` block is configured
2. **SMTP**, when `SMTP_HOST` is set
3. The **log transport**, which writes the rendered message out

Graph wins over SMTP deliberately. It is the explicitly-credentialed choice,
whereas SMTP settings are easy to leave pointing at a local catcher by accident.
The log transport is not a stub: it keeps local development free of a mail
container while still exercising the whole
queue → processor → template → integration path, so the only untested link is
the socket.

The Graph transport is written against `fetch` rather than
`@microsoft/microsoft-graph-client` plus MSAL. It needs exactly two calls —
fetch a token, post a message — and two SDKs to make them would be more surface
area than the code they replace. It uses the client-credentials flow, so the app
registration needs the **application** permission `Mail.Send` with admin consent;
the delegated permission of the same name cannot work, because a queue worker has
no signed-in user.

Three details are load-bearing:

- **Partial configuration fails at boot.** If any `MICROSOFT_GRAPH_*` value is
  present, all of them must be. A half-configured Graph would silently fall back
  to the log transport and look like it was delivering mail — nobody notices
  until someone says they never got an invitation.
- **`MICROSOFT_GRAPH_BASE_URL` is normalised.** Both `https://graph.microsoft.com`
  and `.../v1.0` appear in Microsoft's own documentation, and picking the wrong
  one is a 404 at the first send rather than anything visible at startup.
- **Every request has a timeout.** `fetch` has none of its own, and a send that
  hangs would occupy a BullMQ worker slot until the process restarts.

A 401 discards the cached token, so a rejected credential is not replayed on the
next attempt. Sending happens on the queue, so a transient Graph failure is
retried by BullMQ rather than failing the HTTP request that triggered it.

### Teams

A team groups people; it does not authorise them. `WorkspaceMember.role` still
decides everything, and the two are kept apart so that moving somebody between
teams cannot quietly change what they can see.

The exception is a team's own administration, and it is the reason `leadId`
exists at all: **editing a team and changing its roster is open to ADMIN and
above, _or_ to that team's lead**. That rule cannot be expressed with
`@RequireWorkspaceRole`, because a decorator does not know which team is being
addressed — so it lives in `TeamsService.assertCanManage` while creating and
deleting stay on the decorator at ADMIN. A lead may run a team but not dissolve
one.

Membership is validated against the workspace on the way in: a team is always a
subset of its workspace, and without the check a roster could carry people with
no access to anything the team works on. Adding someone twice is an upsert rather
than a conflict — the second add expresses the same intent as the first.

Two invariants are maintained rather than left to the schema:

- Appointing a lead adds them to the team, on both create and update. A lead who
  is not in their own team is a strange thing to have to repair by hand.
- Removing the lead from the roster clears `leadId`, and so does removing them
  from the workspace. Neither can leave the two records disagreeing.

Deleting a team is a real delete, not an archive: a grouping holds no history.
`Project.teamId` is `SetNull`, so projects outlive the team that owned them.
`ProjectsService` validates `teamId` against the workspace for the same reason
membership is validated — the foreign key alone would accept a valid team id
belonging to someone else's workspace, leaking its name and colour through the
project badge.

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

## Attachments

Files go straight from the browser to object storage and never through the API,
so request memory and timeouts stay bounded whatever the file size. The cost is
that the upload happens somewhere the API cannot watch, which shapes everything
else here.

Three steps. `POST /attachments` declares a file and returns a short-lived
presigned PUT; the browser PUTs the bytes to storage; `POST
/attachments/:id/confirm` reads the stored object back and only then does the
attachment become visible. Rows sit at `PENDING` until confirmed and are never
listed or served, so an abandoned upload is invisible rather than a broken link.
A worker job sweeps them hourly.

**Confirm is the security boundary, not a formality.** A presigned PUT has no
way to express a size limit — S3 and MinIO simply cannot — so a URL issued for
a 2 KB image will accept a gigabyte. This was verified against MinIO rather than
assumed. Re-reading the object is what makes the recorded size true; a mismatch
deletes the bytes rather than leaving them to the sweeper.

Content type *is* enforceable, but only if it is signed. By default the AWS SDK
signs `host` alone and `ContentType` degrades to a suggestion: a URL signed for
`image/png` accepted `text/html` and stored it as such. Naming it in
`signableHeaders` puts it in `SignedHeaders`, and the swap now fails with a 403
at storage.

Downloads are presigned GETs that always set `Content-Disposition: attachment`.
`image/svg+xml` is an accepted upload type and an SVG can carry script, so
rendering one inline would be stored XSS on the storage origin. Setting the
disposition at signing time means it cannot be dropped by whatever wrote the
object.

`STORAGE_PUBLIC_ENDPOINT` exists because SigV4 signs the Host header. In Docker
the API reaches storage at `coretask-minio:9000`, a name that resolves only on
the compose network, so a URL signed with it is useless to a browser — and the
hostname cannot be patched in afterwards without invalidating the signature. A
second S3 client, pointed at the address the client will actually connect to,
does the signing. Against real S3 the two addresses are the same and the second
client is never created. The e2e suite overrides it back to the internal name,
because there the test process *is* the browser.

## The inbox

Notifications were written before there was anywhere to read them: the module
recorded and dispatched, and the only surface was a bell dropdown holding eight
entries. The feed took a limit and nothing else, which is right for a dropdown
and not enough for a page.

Reading is scoped by the caller's id as well as the workspace, and the route
carries no user id to tamper with. Membership of a workspace is never enough to
read another member's inbox; the same scoping makes marking someone else's
notification read a no-op that changes nothing rather than an error that reveals
the entry exists.

Paging is by cursor, not offset. The inbox grows at the top, so with an offset
one notification arriving between requests shifts every row down and the reader
sees an entry twice. The cursor is the row id rather than `createdAt`: ids are
UUID v7 so they sort identically, and unlike a timestamp they are unique — two
notifications written in the same millisecond would otherwise make the cursor
ambiguous.

`unreadCount` counts the whole workspace on every page and ignores the filters.
It drives a badge, and a badge that changed when you switched tabs would be
describing the tab rather than the inbox.

`unreadOnly` is transformed explicitly rather than cast. A query string carries
strings, so `?unreadOnly=false` is the truthy string `"false"`, and a naive cast
inverts the filter: the "All" tab silently shows only unread. There is a test
for exactly that.

Live updates come from the existing gateway. `NotificationDispatcher` already
emitted to the recipient's own socket room, and the client already listened —
but only to raise a toast, so the bell and an open inbox kept showing the last
fetched count. The listener now also invalidates the notification queries.
Invalidating on a socket event cannot loop the way a render-driven refetch can,
which is what caused the earlier 429 storm.
