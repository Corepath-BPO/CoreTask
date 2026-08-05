# System overview

## Components

| Component           | Runtime                 | Responsibility                                   |
| ------------------- | ----------------------- | ------------------------------------------------ |
| `coretask-web`      | Vite dev server / nginx | Browser client. Static assets in production.     |
| `coretask-api`      | Node — `dist/main.js`   | REST API and Socket.IO gateway.                  |
| `coretask-worker`   | Node — `dist/worker.js` | BullMQ consumer. Same codebase, no HTTP surface. |
| `coretask-postgres` | PostgreSQL 17           | System of record.                                |
| `coretask-redis`    | Redis 7                 | Queues, cache, future Socket.IO adapter.         |
| `coretask-minio`    | MinIO                   | S3-compatible object storage for attachments.    |

## Boundaries

The browser never talks to PostgreSQL, Redis or MinIO. Every read and write goes
through the API, which is the only component holding credentials for those
services.

`web` and `api` are independently deployable. They share three packages, and
what those packages may contain is a hard rule:

| Allowed                                | Forbidden                                    |
| -------------------------------------- | -------------------------------------------- |
| Enums, error codes, socket event names | Prisma client or any database access         |
| API response and entity types          | NestJS decorators or server-only DI          |
| Zod schemas, field limits, route paths | Secrets or server-only environment variables |

The rule is enforced by construction: the shared packages have no dependency on
Prisma, NestJS or the API package, so a violation fails the build.

## Request flow

A typical authenticated request:

```
browser
  │  Authorization: Bearer <access token>
  ▼
requestIdMiddleware      assigns/echoes X-Request-Id
  ▼
helmet · compression · cookieParser · CORS allowlist
  ▼
ThrottlerGuard           per-IP rate limit
  ▼
JwtAuthGuard (global)    verifies the token, re-reads the user
  ▼
WorkspaceMemberGuard     resolves membership for :workspaceId, checks the role
  ▼
ValidationPipe           class-validator DTO, unknown properties rejected
  ▼
Controller (thin)  ──►  Service (business logic)  ──►  PrismaService
  ▼
ResponseInterceptor      wraps the return value in { success, data, meta }
  ▼
browser
```

Errors leave through a single exit — `AllExceptionsFilter` — which renders
`{ success: false, error: { code, message, details } }` and keeps stack traces
server-side.

## Realtime

Socket.IO is mounted on the `/realtime` namespace. A client authenticates during
the handshake with the same access token it uses for REST, then joins rooms:

- `user:<userId>` — joined automatically, carries notifications across devices.
- `workspace:<workspaceId>` — joined on request, **after the server re-checks
  membership**. Knowing a room name is not enough to read another tenant's
  events.

Because access tokens rotate every 15 minutes while a socket may live far
longer, the client passes `auth` as a callback so each reconnection sends a
fresh token.

## Background work

Producers live in the API (`src/jobs/*/`.queue.ts`), consumers only in the worker
(`src/jobs/_/_.processor.ts`). The two never compete for the same job, and a slow
job cannot delay a request.

The implemented path — registration → `coretask.email` queue → worker →
`EmailService` — exists to prove the whole chain end to end. Enqueue failures are
swallowed and logged: a Redis outage should degrade the welcome e-mail, not the
registration that triggered it.

## Multi-tenancy

Every workspace-owned table carries `workspaceId` directly, even where it could
be derived through a parent. That makes the tenant filter one indexed column
away in every query, and it means a missing join can never silently widen the
scope of a result.

Membership is resolved once per request by `WorkspaceMemberGuard` and attached to
the request object. Services read the role from there — they never trust a
workspace id supplied by the client.

Unknown and unauthorised workspace ids both answer `403 WORKSPACE_ACCESS_DENIED`.
Distinguishing them would let an attacker enumerate which ids exist.

## Observability

Every request carries a correlation id (`X-Request-Id`), generated if the caller
does not supply one, echoed on the response, and attached to every log line for
that request. Logs are pretty-printed locally and newline-delimited JSON
elsewhere. Authorization headers, cookies and password fields are redacted at the
logger.

`GET /api/v1/health` reports PostgreSQL and Redis independently and always
answers `200`, so an orchestrator can distinguish "the process is up" from "a
dependency is down" by reading `data.status`.

## The project module

The project upgrade added four documents of its own:

- [project-views.md](./project-views.md) — why a project is not a board, how
  saved views store presentation without copying tasks
- [custom-fields.md](./custom-fields.md) — user-defined fields, statuses and
  priorities, and why category outlives a rename
- [automation-engine.md](./automation-engine.md) — rule execution, and the three
  loop-protection mechanisms
- [color-system.md](./color-system.md) — semantic tokens and why a stored colour
  is never a CSS class

The status and priority migration is deliberately incomplete and documented
separately in
[docs/database/project-view-migration.md](../database/project-view-migration.md).
Read it before touching `Task.status`.
