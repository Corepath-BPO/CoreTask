# 0006. Frontend and backend are independently deployable

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

`web/` and `api/` live in one repository and share three packages. The question
is whether that shared repository should also mean a shared deployment.

The two have genuinely different runtime profiles: the client is a static bundle
that wants a CDN, while the API is a stateful long-running process that holds
database and Redis connections. They also change at different rates — UI work
ships far more often than schema work.

## Decision

Keep them **independently deployable**. They communicate only over the REST API
and Socket.IO. Neither imports the other's source.

Sharing is limited to three packages, with a hard rule about their contents:

| Allowed                                    | Forbidden                                  |
| ------------------------------------------ | ------------------------------------------ |
| Enums, error codes, socket event names     | Prisma client, any database access         |
| API response and entity types              | NestJS decorators, server-only DI          |
| Zod schemas, field limits, route constants | Secrets, server-only environment variables |

## Alternatives considered

**A single deployable serving both.** Fewer moving parts, one URL, no CORS. It
also couples the release cadence of a CSS tweak to that of a database migration,
forces the API's scaling profile onto static assets, and — most importantly —
removes the boundary that stops UI code reaching into the database.

**Separate repositories.** Achieves the same independence, at the cost of
cross-repo changes for every contract change and no way to type-check both sides
against the same definitions at once. A monorepo with independent deployables
gets both properties.

## Consequences

**Easier**

- Each side scales and deploys on its own schedule. The client can go to a CDN.
- The API is genuinely reusable by mobile and third-party clients, because the
  web client has no privileged path into it.
- The contract is explicit and type-checked. Renaming a socket event or an error
  code is a compile error on both sides.
- The boundary is enforced by construction: the shared packages do not depend on
  Prisma or NestJS, so a violation fails the build.

**Harder / accepted**

- CORS and cookie configuration have to be right. `WEB_URL` drives the allowlist;
  `COOKIE_SAME_SITE` and `COOKIE_DOMAIN` are explicit environment settings.
- Two images to build and version.
- `VITE_*` values are baked into the bundle, so changing the API origin means
  rebuilding the web image.
- The shared packages must be built before either app compiles. `pnpm -r build`
  handles the ordering topologically; the Docker images build them explicitly.
