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
| Storage       | RustFS locally, any S3-compatible service in production                  |

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
├── site/                     Marketing site (Next.js, static export) — see site/README.md
├── api/                      NestJS REST + WebSocket API
│   ├── src/config/           environment schema and typed config
│   ├── src/common/           filters, guards, interceptors, decorators, DTOs, utils
│   ├── src/database/         Prisma service
│   ├── src/modules/          auth, users, workspaces, workspace-members, …
│   ├── src/integrations/     email, storage, notification dispatch, AI
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

| Tool           | Version | Notes                                                                                                       |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| Node.js        | ≥ 24.9  | Only needed outside Docker. The API runs on 22.12+, but its Jest suites need 24.9+ (see api/jest.config.ts) |
| pnpm           | ≥ 9     | `corepack enable && corepack prepare pnpm@latest --activate`                                                |
| Docker Desktop | ≥ 24    | With Compose v2 (`docker compose`)                                                                          |
| Git            | any     |                                                                                                             |

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

The full stack — web, API, worker, PostgreSQL, Redis and RustFS for object storage:

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

`pnpm infra` starts only PostgreSQL, Redis and RustFS, and creates the storage
bucket — the combination you want when running the API and web dev servers on
the host.

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

On Windows, `scripts\dev-local.ps1` does all of the above in one go, starts the
worker as well, and opens each service in its own PowerShell window. Pass
`-BuildPackages` after editing a shared package and `-Seed` on an empty
database. `scripts\dev-local-stop.ps1` ends the three services (add `-Infra`
to stop the containers too). Pair it with a `%USERPROFILE%\.wslconfig` that caps the Docker VM
(for example `memory=2GB`, `processors=2`) so the three infra containers stay
cheap on a small laptop.

---

## Default ports

| Service         | URL                                   |
| --------------- | ------------------------------------- |
| Frontend        | http://localhost:5173                 |
| API             | http://localhost:3000                 |
| REST base       | http://localhost:3000/api/v1          |
| Swagger UI      | http://localhost:3000/api/docs        |
| OpenAPI JSON    | http://localhost:3000/api/docs-json   |
| Health          | http://localhost:3000/api/v1/health   |
| PostgreSQL      | localhost:5432                        |
| Redis           | localhost:6379                        |
| Storage API     | http://localhost:9000                 |
| Storage console | http://localhost:9001/rustfs/console/ |

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
interceptors as production) with Supertest, against a dedicated PostgreSQL
**schema** and BullMQ queue prefix — your development data is never touched.
Both are named for the checkout (`coretask_e2e_<folder>_<hash>`), so runs in two
git worktrees at once keep apart; set `E2E_SCHEMA` to give a second run in the
same checkout its own.

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
- Dates the way Asana keeps them: a start date beside the due date, an
  optional time of day on each, one picker shared by the panel, the list and
  subtasks, and calendar dates that read as the same day in every timezone —
  see [Task dates, times and rich text](docs/architecture/task-dates-and-rich-text.md)
- Rich-text descriptions on tasks and tickets — bold, lists, links, code,
  headings, `@` mentions that notify, pasted pictures shown in place — stored
  as HTML that the API sanitises before it stores anything
- Multi-select in the List — click, shift-click, ctrl-click — with Asana's
  bulk bar for assignee, due date, status, priority, section and archive,
  backed by one bulk endpoint that takes the same paths a single edit does
- Asana's Tab-key shortcuts (Tab+N, Tab+A, Tab+M, Tab+D, Tab+Y, Tab+T, Tab+C,
  Tab+S, Ctrl+Enter) for the open task or the selected rows, and a `?` sheet
  that lists them — see
  [List selection, bulk edit and keyboard shortcuts](docs/architecture/list-selection-and-shortcuts.md)
- Filter, Sort, Group and Options on the List and the Board, held in the
  saved view: quick filters ("Just my tasks", "Due this week" as relative
  dates the server resolves), up to five sorts across tasks and tickets in one
  SQL ordering, grouping by status, priority, assignee or a select field with
  drag-between-groups setting the value, columns and density under Options,
  card fields on the Board, and "Save as my view" for anyone who may not
  change the shared one — see
  [Project views](docs/architecture/project-views.md)
- Eleven custom field types including rating (stars) and formula (worked out
  on read from the project's number and date fields), currency and custom-unit
  formats, "notify collaborators when this field changes", a story per value
  change, the bulk bar's Fields pill, hidden options, and Asana's "remove from
  project / delete from workspace" choice with a library restore — see
  [Custom field system](docs/architecture/custom-field-system.md)
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
  with a filter to match. Deliberately _not_ a permission boundary — see below
- Comment threads on tasks and tickets: rich text with inline pictures and
  files posted with a comment, edit in place (marked "edited"), delete with a
  confirm, likes, one pinned comment per thread, permalinks, drafts that
  survive closing the panel, and older comments behind "Show earlier"
- `@mentions` with a keyboard-navigable picker, stored in the comment text so
  editing stays honest, parsed server-side so a client cannot notify at will
- Collaborators on every task and ticket — added when you create, are
  assigned, comment or are mentioned; leave or add by hand — and they are who
  a comment or a due-date change notifies
- The task panel's activity feed: system stories ("moved to In Review",
  "changed the due date from Sep 1 to Sep 12") interleaved with the comments,
  with Asana's "All activity / Comments only" switch
- Comment and attachment counts on list rows and board cards; image
  thumbnails and a lightbox in the attachment strip
- Global search (Ctrl/⌘ K or `/`): tasks, tickets, projects and people, best
  match first, narrowed by kind, with recents — private projects stay private
- Asana's Create menu: a task from anywhere (Tab+N too), a project, a team, an
  invitation or a workspace
- Starred projects in the sidebar, starred from a project's header or the
  projects list — a per-person bookmark
- Project tabs beyond List and Board: a Timeline (Gantt bars dragged to move,
  ends dragged to change a date), a Calendar (bars from start to due, dragged
  to reschedule, an Unscheduled tray), a Dashboard (totals, completion, open
  work by section and assignee, a burn-up) and the project's Activity feed
- Task likes, and dependencies — blocked by / blocking, with a loop guard —
  plus the pane's full-screen view, a "…" menu (duplicate, copy link, open in
  a new tab, archive), status and priority rows, and links to subtasks
- My Tasks in Asana's sections — Recently assigned, Do today, Do next week,
  Do later — personal, dragged or moved by menu
- Inbox Archive and Bookmarks, with "Archive all"
- Profiles with pronouns, title, department and out-of-office dates, shown
  beside a name when someone picks an assignee; My Tasks auto-sort by due date
- Sync to calendar: a private iCalendar link for My Tasks or a project, which
  can be reset and follows its owner's access
- Ticket rules: when a ticket is reported or changes status, check it and
  triage it — status, priority, assignee, section, comments, e-mail, a task
- Rules that wait: a Wait step of minutes, hours or days, after which the
  rest of the rule runs against the task as it is by then
- Connectors: OAuth 2.0 apps (register under Integrations › OAuth apps; people
  allow them on a consent page and disconnect them under Connected apps), and
  webhook subscriptions an API key or app makes through the API, one project
  at a time
- AI in rules (with an Anthropic API key): "Use AI…" makes the changes its
  instructions call for, from a list the author ticks and the project's own
  options, and "Check with AI" lets a yes-or-no question decide a path
- Rules that add a task to another project as well, fill variables into the
  subtasks they create, and e-mail the people on a task
- Goals: a tree of outcomes with status, owner, team and time period, and
  progress set by hand, rolled up from sub-goals or connected projects, or
  measured by a number moving from a start towards a target
- Rules that are not edits: run by hand from a task's menu or a selection,
  on a schedule (with Asana's execution scope), or by a due or start date
  drawing near or passing — plus "no longer blocked", "attachment added" and
  "collaborator added", new actions (complete or reopen, create a task, rename
  with variables, collaborators, remove from project) and new checks
- Project Messages (posts and replies) beside status updates kept on the
  server, a Files tab, and repeating tasks ("Set to repeat")
- Portfolios kept on the server — shared with the workspace, filtered by what
  each person can open — with Dashboard, Progress, Workload (load against
  per-person capacity, in tasks or estimated hours) and Messages tabs, and a
  status of their own set by the owner or a manager
- Milestones and approvals beside ordinary tasks (approve, request changes,
  reject), follow-up tasks, and task templates with their subtasks
- Intake forms: a public link anyone can fill in without an account, each
  response a task in the project with the answers in its description
- Status templates that fill the status composer, and rules on a custom date
  field drawing near or passing
- Bundles: one project's sections, fields, rules and task templates applied
  to others and kept in step when the source changes
- Report dashboards: shared charts of tasks by status, priority, assignee,
  project or week, answered per viewer over what they can see
- Multi-homing: a task in several projects, in its own section and place on
  each board, visible through any of them, with each project's rules and
  fields applying to it
- Project templates and "Duplicate project": sections, tasks with subtasks and
  relative dates, fields, rules and task templates, as chosen
- Export to CSV: a project's tasks with Asana's columns and one per custom
  field, safe to open in a spreadsheet
- Team pages: the team's projects and people, and its own Messages
- Project Note, Workload and Settings tabs: a shared document, open work by
  person and week (drag a task to reassign or reschedule it), and statuses,
  priorities and details in one place
- Tags: workspace labels on tasks, on cards and in a List column, filtering
  views and search, managed in Settings
- Time tracking: time logged by hand or with a timer against a task's
  estimate, entry by entry
- Advanced search over tasks — words, assignee, projects, status, due date,
  creator, collaborators — as a link, with saved searches in the sidebar
- Apps: a project's updates posted to Slack, Microsoft Teams, Google Chat or
  Discord, as each tool's own messages
- Two-way Slack: `/coretask` and a message shortcut make tasks as the linked
  person, and the app's channel posts carry buttons to complete or take a
  task — see [Slack](docs/integrations/slack.md)
- Email to a project: an address per project whose mail becomes tasks, with
  comments sent back to the people on the email and their replies kept as
  comments
- Read-only activity feed and a per-user notification inbox with unread counts
- A Home driven entirely by live data — no fixtures anywhere in the app — with
  widgets each person shows, hides and reorders, and a private notepad
- Health endpoint, Swagger, structured logging with correlation ids
- Realtime gateway with authenticated, membership-checked rooms
- BullMQ queue + worker process (welcome e-mail on registration)
- Real outbound e-mail through Microsoft Graph, or written to the log when Graph
  is not configured — see [Outbound e-mail](docs/architecture/backend.md)

### Design notes

A team is an _organisational_ grouping, not a permission boundary.
`WorkspaceMember.role` still decides everything anyone is allowed to do; a team
answers "who works on this together". Keeping the two apart is what stops moving
somebody between teams from silently changing what they can see — the classic
mess that follows from conflating them.

The one place a team does confer authority is its own management: editing a team
and changing its roster is open to workspace administrators _or_ that team's
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
STORAGE_API_PORT=9000
STORAGE_CONSOLE_PORT=9001
```

Remember to update `DATABASE_URL`, `API_URL` and `VITE_API_URL` to match when
you run anything on the host.

Find the offender:

```bash
docker ps --format "{{.Names}}\t{{.Ports}}"
```

### `coretask-storage` will not start: port 9000 already allocated

A stack created before the move from MinIO to RustFS still has its old
`coretask-minio` container holding ports 9000 and 9001. Compose no longer
defines that service, so `up` leaves it running. Remove it as an orphan:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --remove-orphans
```

Nothing stored in MinIO carries over: RustFS starts on a new, empty volume, so
attachments uploaded before the switch will show as missing. Once you no longer
need them, reclaim the space with `docker volume rm coretask-minio-data`.

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

| Document                                                                                     | Covers                                                                      |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [System overview](docs/architecture/system-overview.md)                                      | Components, request flow, boundaries                                        |
| [Frontend](docs/architecture/frontend.md)                                                    | Structure, state, data access, styling                                      |
| [Backend](docs/architecture/backend.md)                                                      | Layering, envelope, guards, jobs                                            |
| [Database](docs/architecture/database.md)                                                    | Schema, indexes, tenancy, ticket keys                                       |
| [Docker](docs/architecture/docker.md)                                                        | Images, Compose layering, volumes                                           |
| [Authentication](docs/api/authentication.md)                                                 | Token lifecycle, cookies, error codes                                       |
| [Task dates, times and rich text](docs/architecture/task-dates-and-rich-text.md)             | Date/instant pairs, overdue, the picker, sanitised HTML, mentions, pictures |
| [List selection, bulk edit and shortcuts](docs/architecture/list-selection-and-shortcuts.md) | Multi-select rules, the bulk bar and route, Tab chords                      |
| [Comments and collaboration](docs/architecture/comments-and-collaboration.md)                | Followers, who gets told, stories in the panel, rich-text threads           |
| [OAuth apps and webhook subscriptions](docs/architecture/oauth-and-connectors.md)            | Authorization-code flow, tokens, revocation, REST hooks for connectors      |
| [Comments, followers and activity API](docs/api/comments-followers-activity.md)              | Threads by cursor, likes, pins, followers, an item's stories                |
| [Project privacy and members API](docs/api/project-members.md)                               | Public/private projects, the roster and its roles, what `access` means      |
| [Custom field system](docs/architecture/custom-field-system.md)                              | Eleven types incl. rating and formula, formats, stories, remove modes       |
| [Field library](docs/architecture/field-library.md)                                          | Sharing one field across projects                                           |
| [List view columns](docs/architecture/list-view-columns.md)                                  | Storage, pinning, sizing, the fixed Task column                             |
| [Custom fields API](docs/api/custom-fields.md)                                               | Definitions, formulas, remove modes, restore, options, values, errors       |
| [Project views](docs/architecture/project-views.md)                                          | Saved views, the Filter/Sort/Group/Options toolbar, ordering across kinds   |
| [View and column API](docs/api/project-view-columns.md)                                      | Views, field catalog, settings keys                                         |
| [Field library migration](docs/database/custom-field-migration.md)                           | Project→workspace move, with its verification run                           |
| [Project work items](docs/architecture/project-work-items.md)                                | One project, two views; tasks and tickets side by side                      |
| [One dataset, two views](docs/architecture/project-views-shared-data.md)                     | What List and Board share, and what each still owns                         |
| [Creating work items](docs/architecture/work-item-creation.md)                               | Split button, quick add, and what the server checks                         |
| [List/Board synchronization](docs/architecture/list-board-synchronization.md)                | Cache keys, invalidation, sockets, correlation ids                          |
| [Work items API](docs/api/project-work-items.md)                                             | List with view settings, create, update, move, bulk; events and errors      |
| [Work-item storage](docs/database/work-item-compatibility.md)                                | Why the tables stay separate, and the migrations                            |
| [Decision records](docs/decisions/)                                                          | Why each major choice was made                                              |

---

## Licence

UNLICENSED — private project.
