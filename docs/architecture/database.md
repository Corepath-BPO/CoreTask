# Database architecture

PostgreSQL 17, accessed exclusively through Prisma. The schema lives in
`api/prisma/schema.prisma`; migrations in `api/prisma/migrations/` are the source
of truth for what is actually deployed.

## Identifiers

Primary keys are **UUID v7** via Prisma's `@default(uuid(7))`, stored as native
`uuid`.

UUID v7 embeds a millisecond timestamp in its high bits, so keys are
time-ordered. That gives the index locality of a sequence — inserts land at the
right edge of the B-tree instead of scattering — while staying unguessable.

No sequential integer id is ever exposed. The one human-readable identifier is
the ticket key, and it is scoped to a workspace.

## Ticket keys

Tickets carry both a `number` (monotonic per workspace) and a denormalised `key`
(`CORE-1001`). `Workspace.ticketCounter` is incremented inside the ticket-creation
transaction, which keeps keys gapless and collision-free without a global
sequence.

`key` is stored rather than computed so it can be indexed and looked up directly.
`@@unique([workspaceId, number])` and `@@unique([workspaceId, key])` guarantee
both stay consistent.

The prefix is derived from the workspace name (`Acme Product` → `ACME`), falling
back to `TASK` for names without usable letters.

## Tenancy

Every workspace-owned table carries `workspaceId` directly — including `Section`,
`Task` and `Comment`, where it could be derived through a parent.

The denormalisation is deliberate. A tenant filter is then always one indexed
column away, so no query depends on remembering a join to stay scoped, and a
missing join cannot silently widen a result set.

## Soft deletion

Applied only where history matters, never as a blanket policy:

| Table        | Column       | Why                                                      |
| ------------ | ------------ | -------------------------------------------------------- |
| `workspaces` | `archivedAt` | Archiving is a product feature, not a delete             |
| `projects`   | `archivedAt` | Same, and tasks keep referring to the project            |
| `tasks`      | `archivedAt` | Activity history and subtasks keep referring to it       |
| `comments`   | `deletedAt`  | Threads and activity feeds keep referring to the comment |

Everything else is deleted for real. `User` uses `isActive` instead, because a
disabled account must still satisfy the foreign keys pointing at it.

## Timestamps

`createdAt` and `updatedAt` on every mutable table. Nullable lifecycle stamps
carry meaning rather than being derived from a status column: `completedAt`,
`resolvedAt`, `closedAt`, `archivedAt`, `deletedAt`, `readAt`, `revokedAt`,
`emailVerifiedAt`, `lastLoginAt`.

`ActivityLog` has **only** `createdAt`. It is append-only; an `updatedAt` on an
audit record would advertise that the record can change.

## Indexes

Beyond primary and unique keys, indexes follow the queries the application
actually issues:

| Table               | Index                                           | Query it serves                       |
| ------------------- | ----------------------------------------------- | ------------------------------------- |
| `users`             | `email` (unique)                                | login                                 |
| `refresh_tokens`    | `tokenHash` (unique)                            | rotation lookup                       |
| `refresh_tokens`    | `sessionId`, `userId`, `expiresAt`              | revoke family, revoke all, purge      |
| `workspace_members` | `[workspaceId, userId]` (unique)                | the membership check on every request |
| `workspace_members` | `userId`, `[workspaceId, role]`                 | workspace list, member list           |
| `projects`          | `[workspaceId, status]`                         | project board                         |
| `tasks`             | `[workspaceId, status]`                         | workspace task views                  |
| `tasks`             | `[projectId, sectionId, position]`              | board column ordering                 |
| `tasks`             | `[assigneeId, status]`                          | "my tasks"                            |
| `tasks`             | `[workspaceId, dueDate]`                        | upcoming deadlines                    |
| `tickets`           | `[workspaceId, status]`, `[assigneeId, status]` | ticket queue                          |
| `activity_logs`     | `[workspaceId, createdAt DESC]`                 | activity feed                         |
| `notifications`     | `[userId, readAt]`                              | unread badge                          |
| `teams`             | `[workspaceId, name]` (unique)                  | team list, duplicate-name rejection   |
| `team_members`      | `userId`                                        | dropping someone from every team      |
| `projects`          | `[workspaceId, teamId]`                         | the team filter on the project list   |

## Teams

`Team` is an organisational grouping, **not** a permission boundary.
`WorkspaceMember.role` remains the only thing that decides what anyone may do.
Keeping them separate is what stops moving someone between teams from silently
changing what they can see.

Two consequences fall out of `TeamMember` pointing at a _user_ rather than a
_membership_:

- Removing someone from a workspace has to delete their `TeamMember` rows for
  that workspace's teams explicitly — the cascade only fires on user deletion.
  `MembersService.remove` does it in the same transaction as the removal, next to
  the assignee unassignment, which has the identical shape of problem.
- `Team.leadId` is `onDelete: SetNull`, and the same removal clears it, so a
  roster can never list someone who has left.

`Project.teamId` is nullable with `onDelete: SetNull`: deleting a team must never
take projects with it.

## Ordering

`Section.position` and `Task.position` are `Float`. Fractional ordering means
inserting between two rows rewrites **one** row (the midpoint of its neighbours)
rather than renumbering everything after it — which matters for drag-and-drop.

## Refresh tokens

One row per issued token. Rotation inserts a new row and revokes the previous
one **in the same transaction**, so a crash between the two cannot leave a
session either dead or replayable.

`sessionId` identifies a token _family_ — one browser or device — and is stable
across rotations. Presenting a token whose row is already revoked means the token
was captured, so the whole family is revoked at once.

Only the SHA-256 hash is stored. SHA-256, not Argon2: the token already carries
256+ bits of entropy, so there is nothing to brute-force. The hash exists so a
database leak cannot be replayed. Passwords, which have low entropy, use Argon2id.

## Migrations

```bash
pnpm db:migrate     # develop: generate + apply
pnpm db:deploy      # CI / production: apply only
pnpm db:reset       # drop, re-migrate, re-seed
```

Migration SQL is committed and reviewed. `prisma db push` is not used outside
throwaway experiments — it would let the deployed schema drift from the history.

## Seed

`api/prisma/seed.ts` is idempotent: every write is an upsert on a natural key, so
the development container can run it on every boot without duplicating anything.
It refuses to run when `NODE_ENV=production`.

It creates one demo user plus three teammates, one workspace, two teams
(`Platform`, `Support`), one project with four default sections, six tasks, five
tickets (`CORE-1001`…`CORE-1005`), seed activity and one notification.

Team rosters are added to, never pruned, on a re-run: the seed is run against
databases people have been clicking around in, and silently ejecting somebody
they added would be a surprising thing for a seed to do.

## Extensions

`infrastructure/postgres/init/01-extensions.sql` enables `pgcrypto` and `pg_trgm`
when the data volume is first created. Neither is required today — UUIDs are
generated in the application layer — but `pg_trgm` is what the search work in the
next phase will index with.

Init scripts run **once**, only on an empty data directory. Schema changes belong
in a migration, never there.
