# API modules

Each directory is a self-contained Nest module: controller (thin, HTTP only),
service (business logic), DTOs (validated request/response shapes).

## Implemented

| Module              | Responsibility                                                     |
| ------------------- | ------------------------------------------------------------------ |
| `auth`              | Registration, login, refresh-token rotation, logout, `/auth/me`    |
| `users`             | User lookup and creation; the only place that reads `passwordHash` |
| `workspaces`        | Tenant containers, creation with OWNER assignment, settings        |
| `workspace-members` | Membership resolution, role checks, `WorkspaceMemberGuard`         |
| `activity-logs`     | Append-only audit trail                                            |
| `notifications`     | In-app notification persistence                                    |
| `health`            | Liveness plus PostgreSQL/Redis dependency checks                   |

## Reserved for the next phase

`projects`, `sections`, `tasks`, `tickets` and `comments` have Prisma models,
enums and shared types in place but no HTTP surface yet — the foundation phase
deliberately stops at the authentication and workspace vertical slices. The
directories exist so the layout is stable; they contain no placeholder code.

When adding one:

1. Model and migration in `prisma/schema.prisma` (already done for these five).
2. Shared types in `packages/types`, enums in `packages/contracts`.
3. `<name>.service.ts` — every query filtered by `workspaceId`.
4. `<name>.controller.ts` — `@UseGuards(WorkspaceMemberGuard)` on any route with
   a `:workspaceId` parameter; controllers stay free of business logic.
5. Register the module in `app.module.ts`.
6. e2e spec in `test/e2e` covering the unauthorised-tenant case.
