# infrastructure/

Configuration consumed by the container images and the Compose stacks. Nothing
here is imported by application code.

| Path                  | Used by                    | Purpose                                                 |
| --------------------- | -------------------------- | ------------------------------------------------------- |
| `nginx/web.conf`      | `web/Dockerfile` (runtime) | Serves the built SPA: caching, SPA fallback, `/healthz` |
| `postgres/init/*.sql` | `coretask-postgres`        | Runs once, only when the data volume is empty           |

## PostgreSQL init scripts

Files in `postgres/init/` are executed in lexical order by the official
PostgreSQL image the first time the data directory is created. They are **not**
re-run on later starts — schema changes belong in a Prisma migration, not here.
Use `pnpm down:volumes` to discard the volume and replay them.

## Adding an environment

The Compose files are the deployment contract for local work only. For a real
environment, generate the same variable set from your secret store and run the
production images (`docker-compose.prod.yml`) behind your own ingress.
