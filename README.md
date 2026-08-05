# CoreTask

A scalable project-management and ticketing platform — workspaces, projects,
tasks, tickets, real-time collaboration and an audit-ready activity trail.

This repository currently contains the **technical foundation**: the monorepo,
the containerised development environment, the database schema, and the first
working vertical slices (authentication and workspaces). Everything else is
scaffolded but deliberately unbuilt — see [Project status](#project-status).

---

## Contents

- [Architecture summary](#architecture-summary)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment setup](#environment-setup)
- [Running with Docker](#running-with-docker)
- [Running locally without Docker](#running-locally-without-docker)
- [Default ports](#default-ports)
- [Demo credentials](#demo-credentials)
- [Database](#database)
- [Testing](#testing)
- [Build](#build)
- [Code quality](#code-quality)
- [Project status](#project-status)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

---

## Architecture summary

CoreTask is a pnpm monorepo with a strict separation between the browser client
and the server. They share **types and contracts**, never code that touches a
database or a secret.

```
┌─────────────┐  REST /api/v1  ┌─────────────┐   ┌──────────────┐
│  web        │ ─────────────► │  api        │──►│  PostgreSQL  │
│  React+Vite │  Socket.IO     │  NestJS     │   └──────────────┘
│  :5173      │ ◄───────────── │  :3000      │──►┌──────────────┐
└─────────────┘                └─────────────┘   │  Redis       │
       │                              │          └──────────────┘
       │        packages/*            │                 ▲
       └──── contracts · types ───────┘                 │
              validation                        ┌──────────────┐
                                                │  worker      │
                                                │  BullMQ      │
                                                └──────────────┘
```

| Layer         | Choice                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| Frontend      | React 19, TypeScript, Vite, Tailwind v4, ShadCN UI                       |
| Routing/state | TanStack Router, TanStack Query, Zustand                                 |
| Forms         | React Hook Form + Zod (schemas shared with the API's constraints)        |
| Backend       | NestJS 11, REST under `/api/v1`, Swagger at `/api/docs`                  |
| Database      | PostgreSQL 17 via Prisma, UUID v7 primary keys                           |
| Cache/queues  | Redis, BullMQ (consumed by a separate worker process)                    |
| Realtime      | Socket.IO gateway, authenticated with the same access token as REST      |
| Auth          | Argon2id passwords, short-lived JWT + rotating refresh token in a cookie |
| Storage       | MinIO locally, any S3-compatible service in production                   |

The frontend and backend are **independently deployable**: the browser talks to
the API only over HTTP and WebSocket, and the API has no knowledge of the
client's build. See [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md)
and the decision records in [`docs/decisions/`](docs/decisions/).

---

## Repository structure

```
CoreTask/
├── web/                      React + Vite client
│   ├── src/app/              providers, layouts, router, config
│   ├── src/components/       ui (ShadCN), common, forms, navigation, feedback, data-display
│   ├── src/features/         auth, workspaces, dashboard, … (vertical slices)
│   ├── src/lib/              api client, socket, mock fixtures, utils
│   ├── src/stores/           Zustand stores (auth, workspace, ui, theme)
│   └── e2e/                  Playwright specs
├── api/                      NestJS REST + WebSocket API
│   ├── src/config/           environment schema and typed config
│   ├── src/common/           filters, guards, interceptors, decorators, DTOs, utils
│   ├── src/database/         Prisma service
│   ├── src/modules/          auth, users, workspaces, workspace-members, …
│   ├── src/integrations/     email, storage, notification dispatch
│   ├── src/jobs/             BullMQ queues and processors
│   ├── src/websocket/        Socket.IO gateway
│   ├── prisma/               schema, migrations, seed
│   └── test/                 unit + e2e suites
├── packages/
│   ├── contracts/            enums, error codes, socket events, field limits
│   ├── types/                API response envelope and entity types
│   ├── validation/           Zod schemas shared by client and server
│   ├── tsconfig/             shared TypeScript configurations
│   └── eslint-config/        shared ESLint flat configurations
├── infrastructure/           nginx config, PostgreSQL init scripts
├── docs/                     architecture, API and decision records
├── docker-compose.yml        base stack (never used alone)
├── docker-compose.dev.yml    development overlay
├── docker-compose.prod.yml   production-shaped overlay
└── .env.example              every variable, documented
```

---

## Prerequisites

| Tool           | Version | Notes                                                        |
| -------------- | ------- | ------------------------------------------------------------ |
| Node.js        | ≥ 20.11 | Only needed for running outside Docker                       |
| pnpm           | ≥ 9     | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker Desktop | ≥ 24    | With Compose v2 (`docker compose`)                           |
| Git            | any     |                                                              |

npm and Yarn are not supported — the workspace uses pnpm's linker and lockfile.

---

## Installation

```bash
git clone <repository-url> CoreTask
cd CoreTask
pnpm install
```

Then create your environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

---

## Environment setup

`.env` at the repository root is the single source of truth. It is git-ignored;
`.env.example` documents every variable and is the file to keep updated.

The API validates its environment at start-up (`api/src/config/env.schema.ts`)
and **exits with a readable error** rather than booting half-configured.

Generate real secrets before any shared environment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must differ, must be at least 32
characters, and the development placeholders are rejected outright when
`NODE_ENV=production`.

Only `VITE_*` variables reach the browser bundle. Never put a secret behind that
prefix.

---

## Running with Docker

The full stack — web, API, worker, PostgreSQL, Redis and MinIO:

```bash
pnpm dev:build
```

Subsequent starts skip the image build:

```bash
pnpm dev
```

The API container applies migrations and seeds the demo workspace on start, so
the app is usable immediately. Other useful commands:

```bash
pnpm logs
```

```bash
pnpm down
```

```bash
pnpm infra
```

`pnpm infra` starts only PostgreSQL, Redis and MinIO — the combination you want
when running the API and web dev servers on the host.

To discard all database and object-storage volumes:

```bash
pnpm down:volumes
```

### How the dev containers are wired

- `api/` and `web/` are bind-mounted for hot reload.
- A **named volume** shadows `node_modules` inside each of those mounts. Docker
  seeds a named volume from the image the first time it is used, so dependencies
  are already installed, are never reinstalled on restart, and Linux-native
  binaries never land in your Windows working tree.
- Each shared package's `dist` is bind-mounted **read-only**, so rebuilding one
  on the host is visible to the containers immediately — no image rebuild. Only
  the build output is mounted, never `packages/*/node_modules`, which on Windows
  holds symlinks into a store the container cannot follow.

### Production-shaped stack

```bash
pnpm prod:build
```

```bash
pnpm prod:up
```

Multi-stage images, no source mounts, no dev tooling, non-root users, health
checks and resource limits. This is a shape to deploy from, not a deployment
manifest — supply the same environment from your secret store and put your own
ingress and TLS in front of `coretask-web`.

---

## Running locally without Docker

Useful when you want a debugger attached directly.

```bash
pnpm infra
```

```bash
pnpm packages:build
```

```bash
pnpm db:deploy && pnpm db:seed
```

```bash
pnpm dev:local
```

`dev:local` runs the API and the web dev server in parallel on the host. Both
read `.env` from the repository root.

---

## Default ports

| Service       | URL                                 |
| ------------- | ----------------------------------- |
| Frontend      | http://localhost:5173               |
| API           | http://localhost:3000               |
| REST base     | http://localhost:3000/api/v1        |
| Swagger UI    | http://localhost:3000/api/docs      |
| OpenAPI JSON  | http://localhost:3000/api/docs-json |
| Health        | http://localhost:3000/api/v1/health |
| PostgreSQL    | localhost:5432                      |
| Redis         | localhost:6379                      |
| MinIO API     | http://localhost:9000               |
| MinIO Console | http://localhost:9001               |

Every published port is configurable — see
[Troubleshooting → port already allocated](#port-already-allocated).

---

## Demo credentials

Created by the development seed:

```
Email     demo@coretask.dev
Password  CoreTask!2024
```

Three additional members exist in the demo workspace with the same password:
`maya@coretask.dev` (ADMIN), `jonas@coretask.dev` (MEMBER),
`priya@coretask.dev` (MEMBER).

> **Development only.** The seed refuses to run when `NODE_ENV=production`, and
> these accounts must never exist in a shared environment. Override them with
> `SEED_USER_EMAIL` / `SEED_USER_PASSWORD`.

---

## Database

All commands run from the repository root and read `DATABASE_URL` from `.env`.

Create a migration after editing `api/prisma/schema.prisma`:

```bash
pnpm db:migrate
```

Apply pending migrations without generating one (CI, production):

```bash
pnpm db:deploy
```

Regenerate the Prisma client:

```bash
pnpm db:generate
```

Seed development data (idempotent — safe to re-run):

```bash
pnpm db:seed
```

Drop everything, re-migrate and re-seed:

```bash
pnpm db:reset
```

Browse the data:

```bash
pnpm db:studio
```

---

## Testing

### Unit tests — no infrastructure required

```bash
pnpm test
```

Runs Jest for the API and Vitest for the web client. Safe on a bare checkout.

### API integration tests — needs PostgreSQL and Redis

```bash
pnpm infra
```

```bash
pnpm test:e2e
```

These boot the real Nest application (same pipes, guards, filters and
interceptors as production) with Supertest, against a dedicated `coretask_e2e`
PostgreSQL **schema** — your development data is never touched.

Covered: health and dependency checks, registration, login, invalid login,
account enumeration resistance, `/auth/me`, refresh-token rotation, replay
detection, logout, workspace creation with OWNER assignment, slug
disambiguation, tenant isolation and role enforcement.

### Browser end-to-end tests

```bash
pnpm --filter @coretask/web test:e2e:install
```

```bash
pnpm dev
```

```bash
pnpm test:e2e:web
```

Playwright drives real Chromium and mobile-viewport browsers against the running
stack, in desktop and Pixel 7 viewports.

Two constraints shape how it authenticates, and both are worth knowing before
adding specs:

- `/auth/login` is rate-limited at a credential-guessing pace, so the suite signs
  in **once per worker** rather than once per test (`web/e2e/fixtures.ts`).
- Refresh tokens rotate, and replaying a spent one revokes the session family.
  That rules out Playwright's usual `storageState` trick — the first test would
  rotate the saved token and every later one would look like an attacker. Sharing
  a live browser context per worker keeps rotation in step instead.

Even so, the suite signs in more often in a minute than a person would. Set
`AUTH_RATE_LIMIT_MAX=100` in `.env` and restart the API before a full run.

### Coverage

```bash
pnpm --filter @coretask/api test:cov
pnpm --filter @coretask/web test:cov
```

---

## Build

Everything, in dependency order:

```bash
pnpm build
```

Individually:

```bash
pnpm --filter @coretask/api build
pnpm --filter @coretask/web build
```

Full verification gate — formatting, linting, types, tests and builds:

```bash
pnpm verify
```

---

## Code quality

```bash
pnpm lint
```

```bash
pnpm format
```

```bash
pnpm typecheck
```

Linting is intentionally **not** type-aware; full type checking is `tsc --noEmit`
in `typecheck`. Keeping the two separate makes linting fast and removes a class
of tsconfig resolution failures in CI and Docker builds.

Validate the Compose files:

```bash
pnpm compose:validate
```

---

## Project status

### Working end to end

- Monorepo, shared packages, Docker development and production stacks
- PostgreSQL schema, initial migration, idempotent seed
- Registration, login, `/auth/me`, logout
- Rotating refresh tokens in an HTTP-only cookie, with replay detection
- Workspace creation (creator becomes OWNER), listing, detail, update, members
- Workspace membership guard and role enforcement
- Project CRUD: derived keys (`PLAT`), default sections on creation, filtering,
  search, pagination, archive and restore
- Section CRUD with fractional reordering, drag-and-drop on the board, and task
  reassignment instead of orphaning on delete
- Task CRUD: board cards, drag between and within columns, inline composer,
  detail panel with one level of subtasks, assignee/priority/status/due date,
  archive and restore
- My Tasks with filters and a rollup computed over the whole filter
- Ticket queue: server-allocated `CORE-1001` keys, triage from the detail
  dialog, filters by person/status/type/priority, search that matches a pasted
  key exactly and otherwise the title, and `resolvedAt`/`closedAt` derived from
  status rather than settable
- Member management: role changes and removal bounded by rank, leaving a
  workspace, ownership transfer, and open work unassigned when someone goes
- Member invitations by e-mail: hashed single-use links that expire in a week,
  a members page with pending offers and revoke, and an accept page that works
  for people who do not have an account yet
- Teams: named groups inside a workspace with a colour, an optional lead, a
  roster drawn from the workspace, and an optional owning team on each project
  with a filter to match. Deliberately *not* a permission boundary — see below
- Comment threads on tasks and tickets: post, edit in place (marked "edited"),
  delete your own, manager moderation, and notifications to everyone already in
  the conversation
- `@mentions` with a keyboard-navigable picker, stored in the comment text so
  editing stays honest, parsed server-side so a client cannot notify at will
- Read-only activity feed and a per-user notification inbox with unread counts
- A dashboard driven entirely by live data — no fixtures anywhere in the app
- Health endpoint, Swagger, structured logging with correlation ids
- Realtime gateway with authenticated, membership-checked rooms
- BullMQ queue + worker process (welcome e-mail on registration)
- Real outbound e-mail through Microsoft Graph, with SMTP and a log transport as
  the other two options — see [Outbound e-mail](docs/architecture/backend.md)

### Design notes

A team is an *organisational* grouping, not a permission boundary.
`WorkspaceMember.role` still decides everything anyone is allowed to do; a team
answers "who works on this together". Keeping the two apart is what stops moving
somebody between teams from silently changing what they can see — the classic
mess that follows from conflating them.

The one place a team does confer authority is its own management: editing a team
and changing its roster is open to workspace administrators *or* that team's
lead. Creating and deleting teams stays ADMIN-only — a lead may run a team but
not dissolve one. Deleting a team is a real delete; its projects survive with no
team attached, because losing a grouping must never take work with it.

### Scaffolded, not implemented

There are no mock fixtures left anywhere in the web app. `lib/mock/` was deleted
when the ticket, activity and notification endpoints shipped, which was always
the intended lifecycle for it.

Tickets have no delete endpoint, by design: `CLOSED` is the terminal state, and
the record of what was reported and what happened to it is the point of a ticket
system. The `Ticket` model has no `archivedAt` to match.

Sidebar destinations without an API render an honest placeholder rather than a
dead link.

---

## Troubleshooting

### Port already allocated

Another service is using a default port. Every published port is configurable in
`.env` — the container-internal ports never change, so only the host side moves:

```
API_PORT=3010
POSTGRES_PORT=55432
REDIS_PORT=56379
WEB_PORT=5173
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
```

Remember to update `DATABASE_URL`, `API_URL` and `VITE_API_URL` to match when
you run anything on the host.

Find the offender:

```bash
docker ps --format "{{.Names}}\t{{.Ports}}"
```

### `Environment validation failed` on API start

The message lists every offending variable. Copy `.env.example` to `.env` and
fill in the blanks. Inside Docker, Compose injects the variables — check that
you started the stack from the repository root so `.env` is picked up.

### The API cannot reach PostgreSQL or Redis

Inside Compose, the hosts are the service names (`coretask-postgres`,
`coretask-redis`), not `localhost`. On the host they are `localhost` with the
published ports. `.env` holds the host-side values; `docker-compose.yml`
overrides them for containers.

### `Failed to resolve import` after adding a dependency

Symptom, usually from Vite:

```
[plugin:vite:import-analysis] Failed to resolve import "@some/package". Does the file exist?
```

You installed on the host, but each container's `node_modules` is a **named
volume**. Docker seeds a named volume from the image only while the volume is
empty — so once it exists, `pnpm dev:build` alone will not update it.

```bash
pnpm dev:reset
```

That stops the stack, drops the three `node_modules` volumes, rebuilds the
images and starts again. Use it whenever you add, remove or upgrade a
dependency. `pnpm dev:build` remains fine for source-only changes.

### Changes to `packages/*` are not picked up in Docker

Their `dist` is mounted, not their source, so the containers see whatever was
built last. Rebuild the packages:

```bash
pnpm packages:build
```

The Vite dev server picks this up on its own; the API's watcher recompiles too.
Nothing needs rebuilding or restarting.

If a **new export** appears missing — `does not provide an export named …`,
pointing at source that is plainly correct — that is this, and it means the
build has not run since the export was added.

### Hot reload not firing in Docker on Windows

Bind mounts from a Windows or macOS host do not deliver filesystem events to the
Linux container, so every watcher has to poll. Both are already configured:

- **web** — `CHOKIDAR_USEPOLLING=true`, read by `server.watch.usePolling` in
  `web/vite.config.ts`.
- **api / worker** — `TSC_WATCHFILE` and `TSC_WATCHDIRECTORY`, which is what
  `nest start --watch` compiles through.

Without these the container keeps serving the code it was built with and says
nothing about it. If you add a service, give it the matching variable.

### `ERR_PNPM_IGNORED_BUILDS`

pnpm blocks dependency lifecycle scripts until they are approved. The approved
list is `allowBuilds` in `pnpm-workspace.yaml`. Add the package there with a
justification rather than approving it interactively.

### Prisma client out of date after pulling

```bash
pnpm db:generate
```

### e2e tests fail with a migration error

They need the infrastructure containers:

```bash
pnpm infra
```

### Everything is wedged

```bash
pnpm down:volumes && pnpm dev:build
```

This deletes the database and object-storage volumes and rebuilds from scratch.

---

## Documentation

| Document                                                | Covers                                 |
| ------------------------------------------------------- | -------------------------------------- |
| [System overview](docs/architecture/system-overview.md) | Components, request flow, boundaries   |
| [Frontend](docs/architecture/frontend.md)               | Structure, state, data access, styling |
| [Backend](docs/architecture/backend.md)                 | Layering, envelope, guards, jobs       |
| [Database](docs/architecture/database.md)               | Schema, indexes, tenancy, ticket keys  |
| [Docker](docs/architecture/docker.md)                   | Images, Compose layering, volumes      |
| [Authentication](docs/api/authentication.md)            | Token lifecycle, cookies, error codes  |
| [Custom field system](docs/architecture/custom-field-system.md) | Types, settings, value storage, lifecycle |
| [Field library](docs/architecture/field-library.md)     | Sharing one field across projects      |
| [List view columns](docs/architecture/list-view-columns.md) | Storage, pinning, sizing, the fixed Task column |
| [Custom fields API](docs/api/custom-fields.md)          | Definitions, options, values, errors   |
| [View and column API](docs/api/project-view-columns.md) | Views, field catalog, task query       |
| [Field library migration](docs/database/custom-field-migration.md) | Project→workspace move, with its verification run |
| [Decision records](docs/decisions/)                     | Why each major choice was made         |

---

## Licence

UNLICENSED — private project.
