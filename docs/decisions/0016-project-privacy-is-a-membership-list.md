# 0016. Project privacy is a membership list, and teams stay organisational

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

Every read in the API ended at `where: { workspaceId }` or
`requireProject(workspaceId, projectId)`. Nothing below the workspace was a
permission boundary: a GUEST could open every project, every task, every
comment and the whole activity feed. Asana's "Private to members" projects had
no counterpart, and the web app had been carrying disabled stubs for it — a Join
button with a padlock, a Members filter — for weeks.

Three questions had to be settled before any of that could be built: what a
private project is private _to_, how far a role inside a project reaches, and
what happens when the people who ran a private project are gone.

## Decision

A project is `PUBLIC` — every member of the workspace, which is what every
project was before and stays the default — or `PRIVATE`: its own members plus
the workspace's admins.

Membership is a row in `project_members` with a role of `ADMIN`, `EDITOR` or
`VIEWER`. **A project role only ever narrows the workspace role.** An EDITOR
acts as at most a workspace MEMBER, a VIEWER as at most a GUEST, and an ADMIN
keeps their workspace role and may also manage the roster and the privacy. The
effective role is computed once per request by `ProjectAccessGuard`, which runs
after `WorkspaceMemberGuard` on every route under a project and **rewrites the
request's workspace role** to the effective one. Every existing role check —
`@RequireWorkspaceRole`, `hasAtLeastRole(role, …)` on the injected role —
honours the cap without knowing projects exist. Where a project id arrives in a
request body instead, the service calls `ProjectAccessService.requireAccess`.

Workspace `OWNER` and `ADMIN` see and manage every project without a
membership row. Nothing is ever unrecoverable: a private project whose admins
have all left the workspace is still reachable by the people who run the
workspace. On top of that, a private project always keeps at least one admin —
demoting or removing the last one is refused with `409 LAST_PROJECT_ADMIN`.

A private project the caller cannot see answers `404`, the same as a project
that does not exist. Over the socket it is `PROJECT_ACCESS_DENIED`, the code the
gateway already used.

Teams remain what ADR-adjacent comments in the schema always said they were:
an organisational grouping, never a permission boundary.

## Alternatives considered

- **"Public to team"** as a third visibility, matching Asana's default. Rejected:
  it makes team membership a visibility boundary, so moving somebody between
  teams silently changes what they can see — the exact mess the schema warned
  about when teams were introduced. A single-organisation workspace does not
  need it; public-to-workspace and private-to-members cover the daily cases.
- **Membership only, no project roles.** Smaller, but it leaves no way to give
  one person read-only access to one project, which is the most common reason
  to share a private project at all.
- **Asana's four roles**, adding `COMMENTER`. The commenter tier needs a new
  permission level threaded through comments, followers and attachments for a
  distinction nobody had asked for. Left out; the three roles map onto the
  workspace ladder that already exists.
- **Strict privacy with no admin override.** Closer to Asana, but a project
  whose last admin was removed from the workspace would need a database fix.
  The override is what keeps the last-admin rule from ever stranding anything.
- **Filtering notifications at read time.** Rejected in favour of filtering at
  fan-out: a notification for an item you cannot open is a broken link either
  way, and the read path stays one indexed query.

## Consequences

- Every list that spans projects — tasks, tickets, the activity feed — carries
  the visibility predicate under `AND: [...]`, because several of those queries
  already own a top-level `OR`. `activity_logs` gained a `projectId` so the feed
  can be filtered at all; `ActivityLogsService.record` resolves it from the
  entity when a writer does not pass it, so no writer can leak a line by
  forgetting.
- A private project's realtime events cannot go to the workspace room any
  more. `ProjectBroadcastService` picks the audience — the workspace room for
  public and unscoped items, the member and admin user rooms for private ones —
  and every domain module emits through it.
- Collaborator fan-out, description mentions and comment mentions drop people
  who cannot see the project; an assignee, a lead or a collaborator must be
  able to see it, or the write is a 400.
- The service account behind an API key is an ordinary member capped at
  MANAGER, so it never has the override: a key must be added to a private
  project to reach it. A workspace-wide webhook endpoint, which only an ADMIN
  can create, still receives private-project events.
- `Project.createdById` was not added. The creator's own `project_members` row
  records who runs it, and a backfill would have had no source.
- The web reads `access` off every project summary and gates from it;
  `PROJECT_ACCESS_REVOKED` on the user's own room tells an open tab to drop the
  project and leave the page.
