# Docker architecture

## Compose layering

Three files, never used alone:

| File                      | Contains                                                      |
| ------------------------- | ------------------------------------------------------------- |
| `docker-compose.yml`      | Service names, networking, health checks, persistent volumes  |
| `docker-compose.dev.yml`  | Dev Dockerfiles, source mounts, published ports, auto-migrate |
| `docker-compose.prod.yml` | Multi-stage builds, resource limits, log rotation, no mounts  |

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml  up   # pnpm dev
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d # pnpm prod:up
```

The base file declares `image:` names for the application services, so it remains
valid on its own for `docker compose config` while the overlays add `build:`.

## Images

| Image                | Base                                 | Contains                                               |
| -------------------- | ------------------------------------ | ------------------------------------------------------ |
| `api/Dockerfile.dev` | `node:24-alpine`                     | Full toolchain, deps installed; package `dist` mounted |
| `api/Dockerfile`     | `node:24-alpine` (multi-stage)       | `dist/`, production deps, Prisma client only           |
| `web/Dockerfile.dev` | `node:24-alpine`                     | Vite dev server                                        |
| `web/Dockerfile`     | `nginxinc/nginx-unprivileged:alpine` | Static bundle only — no Node.js at runtime             |

All four use the **repository root** as build context, because a workspace
package cannot be installed without the root lockfile and `pnpm-workspace.yaml`.

Manifests are copied before source so the dependency layer survives a source
edit. `pnpm install --filter "@coretask/api..."` installs the API plus its
workspace dependencies only — the web toolchain never enters the API image.

`openssl` and `libc6-compat` are installed explicitly: Prisma's query engine
links against OpenSSL, and the compat shim covers prebuilt native modules.

## Development mounts

This is the part that makes restarts fast and keeps a Windows host clean:

```yaml
volumes:
  - ./api:/app/api # bind mount — hot reload
  - coretask-api-node-modules:/app/api/node_modules # named volume — shadows it
```

Docker seeds a **named** volume from the image the first time it is used. So
`node_modules` is already populated from the build, is not reinstalled on
`docker compose up`, and Linux-native binaries are never written back into the
Windows working tree.

Each shared package's `dist` is bind-mounted **read-only**. The containers
therefore read whatever the host built last, and `pnpm packages:build` is enough
to publish a change to all three services — no image rebuild, no restart.

Only the build output is mounted, never `packages/*/node_modules`: on a Windows
host that directory is full of symlinks into a pnpm store the Linux container
cannot follow. Read-only because nothing in a container should be writing to the
working tree.

This replaced compiling the packages into the image. That was tidier in
principle — no shared directory, no chance of two containers racing on one
`dist/` — but the failure mode was bad out of proportion to the benefit: forget
the rebuild and the app dies with `does not provide an export named …`, pointing
at source that is correct on disk, with nothing connecting the error to the
missing step.

Each service has its own `node_modules` volume, so the API and web containers
cannot corrupt each other's install.

**The catch, and it bites every time it is forgotten:** Docker seeds a named
volume from the image _only while the volume is empty_. Once it exists, a
rebuilt image does not update it. So adding a dependency needs the volume
dropped, not just `--build`:

```bash
pnpm dev:reset
```

The symptom otherwise is Vite reporting `Failed to resolve import` for a package
that is plainly present in `package.json` and on the host.

## Start-up ordering

`depends_on: { condition: service_healthy }` gates the API on PostgreSQL and
Redis. The PostgreSQL health check passes `-U` and `-d`:

```yaml
test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
```

Without them, `pg_isready` reports ready before the application database exists
and the API starts against nothing.

The dev API entrypoint then runs `prisma generate`, `prisma migrate deploy` and
the seed before handing over to the dev server, so `pnpm dev` on a clean machine
produces a working, populated application.

`RUN_MIGRATIONS=false` on the worker: two processes racing `migrate deploy` would
contend on the same advisory lock. The worker also waits for the API to become
healthy, which is the signal that migrations are done.

## Health checks

| Service    | Check                                                       |
| ---------- | ----------------------------------------------------------- |
| PostgreSQL | `pg_isready -U … -d …`                                      |
| Redis      | `redis-cli ping`                                            |
| MinIO      | `mc ready local`                                            |
| API        | `node -e "fetch('…/api/v1/health')"` — no curl in the image |
| Web (prod) | `wget --spider …/healthz` — a real nginx location, not `/`  |
| Worker     | process liveness; a queue consumer has no HTTP surface      |

The web `/healthz` location returns a literal `200` and does **not** fall through
to `index.html` — otherwise the SPA fallback would make every path look healthy.

## Production hardening

- Multi-stage builds; the toolchain never reaches the runtime image.
- The API image is assembled with **`pnpm deploy`**, not `pnpm install --prod`.
  Pruning in place leaves every package in pnpm's virtual store
  (`node_modules/.pnpm`), so typescript, jest and eslint still ship — verified by
  inspecting the built image. `deploy` writes a fresh, self-contained tree with
  production dependencies only and workspace packages copied in rather than
  symlinked. The Prisma client is regenerated inside that tree afterwards,
  because the deployed `node_modules` does not carry the builder's output.
- The Prisma CLI is a runtime dependency so `prisma migrate deploy` can be run
  from the shipped image. It brings TypeScript along transitively; that is the
  known cost of keeping migrations runnable in place.
- Non-root: the API runs as `node`; the web image uses nginx-unprivileged, which
  runs as uid 101 and listens on 8080 so no capability is needed to bind.
- Resource limits and JSON log rotation on every application service.
- PostgreSQL is not published to the host by default.
- `VITE_*` values are baked in at build time — changing the API origin means
  rebuilding the web image, which is inherent to a static bundle.

## Volumes

| Volume                    | Holds                    |
| ------------------------- | ------------------------ |
| `coretask-postgres-data`  | Database                 |
| `coretask-redis-data`     | AOF persistence          |
| `coretask-minio-data`     | Objects                  |
| `coretask-*-node-modules` | Per-service dependencies |

```bash
pnpm down            # stop, keep data
pnpm down:volumes    # stop and delete everything
```

## Object storage bootstrap

`coretask-minio-init` runs `mc mb --ignore-existing` and exits 0. Seeing it as
`exited` in `docker compose ps` is the success state, not a failure.
