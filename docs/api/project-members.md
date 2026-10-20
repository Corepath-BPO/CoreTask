# Project privacy and members API

All routes require a bearer token and pass `WorkspaceMemberGuard`, then
`ProjectAccessGuard`. Every response is the standard envelope,
`{ "success": true, "data": … }`. See
[../decisions/0016-project-privacy-is-a-membership-list.md](../decisions/0016-project-privacy-is-a-membership-list.md)
for why it is shaped this way and
[../architecture/backend.md](../architecture/backend.md#project-privacy-and-membership)
for how the guard lowers the caller's role.

## Visibility

A project is `PUBLIC` (every workspace member — the default) or `PRIVATE` (its
members plus workspace `OWNER`/`ADMIN`). `visibility` is accepted on
`POST /projects` and `PATCH /projects/:id`; changing it needs a project admin.

A private project the caller cannot see is a **`404 RESOURCE_NOT_FOUND`** on
every route naming it, exactly like a project that does not exist. Its tasks,
tickets, comments, attachments and activity lines are left out of every list
and are `404` by id.

## What a project summary carries

Every `ProjectSummary` (list rows, detail, create and update responses) has:

```json
{
  "visibility": "PRIVATE",
  "memberCount": 3,
  "members": [
    {
      "user": { "id": "…", "name": "Demo Owner", "email": "…", "avatarUrl": null },
      "role": "ADMIN"
    }
  ],
  "access": {
    "effectiveRole": "MEMBER",
    "projectRole": "EDITOR",
    "isMember": true,
    "canManage": false
  }
}
```

- `members` is a preview — the first five, admins first. Never derive "who is
  the last admin" from it; use the members list.
- `access` is the **caller's** standing: `effectiveRole` is the workspace role
  after the project role's cap (EDITOR → at most MEMBER, COMMENTER and VIEWER
  → at most GUEST, ADMIN → no cap) and is what every "can I edit this" check
  should read. A COMMENTER differs from a VIEWER only in the conversation:
  they may comment on the project's tasks and tickets, like comments and
  reply to its messages, as an EDITOR may (`effectiveConversationRole`). They
  may not start a message, attach files or change anything. A workspace GUEST
  stays read-only as a COMMENTER, because a project role never raises the
  workspace role.
  `canManage` is whether the caller may change the roster and the privacy — a
  project ADMIN, or a workspace OWNER/ADMIN. It is per reader, so realtime
  payloads omit it.

## Members

Base: `/api/v1/workspaces/:workspaceId/projects/:projectId`

| Method   | Path                     | Purpose                                                     | Who                                  |
| -------- | ------------------------ | ----------------------------------------------------------- | ------------------------------------ |
| `GET`    | `/members`               | the roster, admins first, then in the order added           | anyone who can see the project       |
| `POST`   | `/members`               | add a workspace member `{ userId, role? }` (default EDITOR) | project admin, or workspace admin    |
| `PATCH`  | `/members/:userId`       | change a role `{ role }`                                    | project admin, or workspace admin    |
| `DELETE` | `/members/:userId`       | remove someone, or yourself                                 | self, project admin, workspace admin |
| `POST`   | `/join`                  | join a public project as EDITOR (a GUEST joins as VIEWER)   | anyone; idempotent                   |
| `POST`   | `/leave`                 | remove yourself                                             | anyone; idempotent                   |
| `GET`    | `/invitations`           | invitations still waiting that land someone here            | project admin, or workspace admin    |
| `POST`   | `/invitations`           | invite someone new by e-mail `{ email, role }`              | workspace admin who can manage it    |
| `GET`    | `/notification-settings` | what the project tells the caller about                     | anyone who can see the project       |
| `PUT`    | `/notification-settings` | choose it `{ notifyOn }`                                    | members only (`409` otherwise)       |

Rules the API enforces:

- Only current workspace members can be added (`400`). Adding someone already on
  the roster leaves their role alone; use `PATCH` to change it.
- The project's creator and its lead (on create, or when `leadId` changes) are
  admins automatically. Naming an existing member as lead never demotes them.
- Going `PRIVATE` adds the actor as an admin when they were not on the roster.
- A private project keeps at least one admin: demoting, removing or the leaving
  of the last one is `409 LAST_PROJECT_ADMIN`. Public projects have no such rule.
- Removing the lead clears `leadId`. Removing someone from the workspace drops
  their project memberships in the same transaction.
- `join` on a private project is a `404` for a non-member — they cannot see it
  to join it — and adds a workspace admin as an editor.
- `POST /invitations` sends a workspace invitation that also names this project
  and the role to hold in it. Only a workspace admin may send one (`403`
  otherwise), as on the Members page: a guest still reads every public project,
  so a project admin who is not one could otherwise widen the workspace. The
  person joins the workspace as a MEMBER, or a GUEST when the project role is
  VIEWER; an address that already holds a live invitation keeps its team and
  any higher role. Someone already in the workspace is `409` — add them
  instead. Accepting joins the workspace and the project in one transaction
  (the project is skipped if it was deleted meanwhile) and answers with its
  `projectId`, which the web app opens. Revoke one with the workspace's
  `DELETE /invitations/:id`.
- `notification-settings` is Asana's per-project notification choice, kept on
  the caller's own membership row (`notifyOn`). The kinds are
  `STATUS_UPDATES`, `MESSAGES`, `TASKS_ADDED` and `TASKS_COMPLETED`. A member
  starts with the first two; an empty list silences the project. Only members
  hear from a project, so a non-member's `GET` answers `member: false` with
  the defaults that joining starts with, and their `PUT` is
  `409 PROJECT_MEMBERSHIP_REQUIRED`. All four kinds arrive as `PROJECT_UPDATE`
  notifications. The email setting for project news decides which of them
  also come by email.

### `ProjectMember`

```json
{
  "projectId": "…",
  "workspaceId": "…",
  "userId": "…",
  "role": "VIEWER",
  "user": { "id": "…", "name": "Priya Raman", "email": "…", "avatarUrl": null },
  "addedAt": "2026-09-15T21:00:00.000Z"
}
```

## Error codes

| Code                          | Status | When                                                                        |
| ----------------------------- | ------ | --------------------------------------------------------------------------- |
| `RESOURCE_NOT_FOUND`          | 404    | the project is private and the caller is not in it                          |
| `INSUFFICIENT_PROJECT_ROLE`   | 403    | visible, but the caller's role _inside the project_ is too low              |
| `INSUFFICIENT_WORKSPACE_ROLE` | 403    | the workspace role itself is too low (checked first)                        |
| `LAST_PROJECT_ADMIN`          | 409    | demoting, removing or leaving as the only admin of a private project        |
| `PROJECT_MEMBERSHIP_REQUIRED` | 409    | choosing a project's notifications without being on it                      |
| `BAD_REQUEST`                 | 400    | adding a non-member; an assignee or collaborator who cannot see the project |
| `PROJECT_ACCESS_DENIED`       | socket | `project:join` refused                                                      |

## Realtime

| Event                         | Room    | Payload                                                    |
| ----------------------------- | ------- | ---------------------------------------------------------- |
| `project:member-added`        | project | `{ workspaceId, projectId, …ProjectMember }`               |
| `project:member-removed`      | project | `{ workspaceId, projectId, userId }`                       |
| `project:member-role-changed` | project | `{ workspaceId, projectId, …ProjectMember }`               |
| `project:access-granted`      | user    | `{ workspaceId, projectId }` — refetch lists               |
| `project:access-revoked`      | user    | `{ workspaceId, projectId }` — drop caches, leave the page |

`project:updated`, `task:*`, `ticket:*`, `comment:*`, `section:*` and
`activity:recorded` for a private project go to its members' and the workspace
admins' own rooms instead of the workspace room. `project:join` is refused for a
private project the socket's user cannot see.

## Integrations

An API key's service account is a member like any other, capped at MANAGER, so it
never has the admin override: **add it to a private project** before it can read
or write there. A workspace-wide webhook endpoint (ADMIN-only to create) still
receives private-project events.
