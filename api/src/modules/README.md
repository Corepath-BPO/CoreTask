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
| `projects`          | Project CRUD, key derivation, archive/restore, default sections    |
| `sections`          | Board columns: CRUD plus fractional reordering                     |
| `activity-logs`     | Append-only audit trail                                            |
| `notifications`     | In-app notification persistence                                    |
| `health`            | Liveness plus PostgreSQL/Redis dependency checks                   |

### Role requirements

Reads are open to any member, including GUEST. Mutations escalate:

| Action                                                  | Minimum role |
| ------------------------------------------------------- | ------------ |
| List or read projects and sections                      | member       |
| Create/edit a project; add, rename or reorder a section | `MEMBER`     |
| Archive/restore a project; delete a section             | `MANAGER`    |

### Nested routing

Projects and sections are mounted under `workspaces/:workspaceId/…` so
`WorkspaceMemberGuard` reads the tenant from the URL rather than each handler
remembering to check it. Section routes nest one level further under
`projects/:projectId`, and the service verifies the section really belongs to
that project instead of trusting the path — otherwise a section id from a
sibling project would resolve through a URL claiming otherwise.

### Ordering

`Section.position` is fractional, and placement is expressed relative to a
sibling (`afterSectionId`) rather than as a raw number, so the server owns the
arithmetic and a client cannot write a colliding value.
`common/utils/position.util.ts` does the midpoint maths and renumbers the list
when a gap shrinks past what double precision can distinguish.

## Reserved for the next phase

`tasks`, `tickets` and `comments` have Prisma models, enums and shared types in
place but no HTTP surface yet. The directories exist so the layout is stable;
they contain no placeholder code.

When adding one:

1. Model and migration in `prisma/schema.prisma` (already done for these three).
2. Shared types in `packages/types`, enums in `packages/contracts`.
3. `<name>.service.ts` — every query filtered by `workspaceId`.
4. `<name>.controller.ts` — `@UseGuards(WorkspaceMemberGuard)` on any route with
   a `:workspaceId` parameter; controllers stay free of business logic.
5. Register the module in `app.module.ts`.
6. e2e spec in `test/e2e` covering the unauthorised-tenant case.
