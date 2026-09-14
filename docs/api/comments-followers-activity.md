# Comments, followers and activity API

All routes require a bearer token and pass `WorkspaceMemberGuard`. Every
response is the standard envelope, `{ "success": true, "data": … }`. See
[authentication.md](authentication.md) for the token rules and
[../architecture/comments-and-collaboration.md](../architecture/comments-and-collaboration.md)
for why the routes are shaped as they are.

## Comments

Base: `/api/v1/workspaces/:workspaceId`

| Method   | Path                         | Purpose                               |
| -------- | ---------------------------- | ------------------------------------- |
| `GET`    | `/tasks/:taskId/comments`    | the latest window of a task's thread  |
| `POST`   | `/tasks/:taskId/comments`    | post on a task (MEMBER)               |
| `GET`    | `/tickets/:idOrKey/comments` | as above, by UUID or key              |
| `POST`   | `/tickets/:idOrKey/comments` |                                       |
| `PATCH`  | `/comments/:commentId`       | edit the body — author only           |
| `DELETE` | `/comments/:commentId`       | soft delete — author, or MANAGER      |
| `POST`   | `/comments/:commentId/like`  | like; idempotent; returns the comment |
| `DELETE` | `/comments/:commentId/like`  | take it back; idempotent              |
| `POST`   | `/comments/:commentId/pin`   | pin to the top — author or MANAGER    |
| `DELETE` | `/comments/:commentId/pin`   | unpin                                 |

### `POST …/comments`

```json
{
  "body": "<p>Reproduced on staging — <span data-mention=\"019f…\">@Ada</span> can you look?</p>",
  "attachmentIds": ["019f…"]
}
```

`body` is rich text, sanitised on the way in with the description's allow-list.
Plain text with `@[Name](uuid)` tokens is still accepted and converted. Markup
with nothing in it is a `422`, the same as whitespace.

`attachmentIds` names files already uploaded to this item by the author and
not yet shown by another comment. Anything else in the list is a `400` and no
comment is written.

### `GET …/comments`

| Query    | Meaning                                                       |
| -------- | ------------------------------------------------------------- |
| `limit`  | up to `COMMENT_PAGE_LIMIT` (50)                               |
| `before` | the previous page's `meta.earliestId`; returns older comments |

The page is oldest-first within the window. `meta` widens the usual pagination
block:

```json
{
  "total": 63,
  "hasEarlier": true,
  "earliestId": "019f…",
  "pinnedCommentId": "019f…"
}
```

The pinned comment is prepended to the first page when it falls outside the
window.

### The comment

```json
{
  "id": "019f…",
  "body": "<p>…</p>",
  "author": { "id": "…", "name": "Ada", "email": "…", "avatarUrl": null },
  "mentions": [{ "id": "…", "name": "…", "email": "…", "avatarUrl": null }],
  "attachments": [{ "id": "…", "filename": "spec.pdf", "commentId": "019f…", "…": "…" }],
  "likeCount": 2,
  "likedByMe": true,
  "likedBy": [{ "id": "…", "name": "…", "email": "…", "avatarUrl": null }],
  "pinnedAt": null,
  "pinnedBy": null,
  "editedAt": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

## Followers

| Method   | Path                                  | Purpose                                     |
| -------- | ------------------------------------- | ------------------------------------------- |
| `GET`    | `/tasks/:taskId/followers`            | who follows, in the order they joined       |
| `POST`   | `/tasks/:taskId/followers`            | `{ "userIds": [] }` — members only (MEMBER) |
| `DELETE` | `/tasks/:taskId/followers/:userId`    | leave, or (MANAGER) remove somebody         |
| `GET`    | `/tickets/:idOrKey/followers`         | as above                                    |
| `POST`   | `/tickets/:idOrKey/followers`         |                                             |
| `DELETE` | `/tickets/:idOrKey/followers/:userId` |                                             |

Every mutation returns the new list: `[{ "user": {…}, "followedAt": "…" }]`.
Adding someone already following is a no-op; removing someone who is not is
one too. Naming a non-member is a `400`.

## Activity

| Method | Path             | Purpose                                     |
| ------ | ---------------- | ------------------------------------------- |
| `GET`  | `/activity`      | the workspace feed, newest first, capped    |
| `GET`  | `/activity/item` | one item's stories, newest first, by cursor |

`/activity/item` takes `entity` (`TASK` or `TICKET`), `entityId`, an optional
`before` (the previous page's `nextCursor`) and `limit` (≤ 100):

```json
{ "items": [ …ActivityEntry ], "nextCursor": "019f…" }
```

Every entry carries `metadata`. For a story it is one of the shapes in
`@coretask/contracts` (`activity-stories.ts`):

| `action`                                              | `metadata`                                            |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `UPDATED`, `ASSIGNED`, `UNASSIGNED`, `STATUS_CHANGED` | `{ field, before, after }`                            |
| `FIELD_CHANGED`                                       | `{ fieldId, fieldName, type, before, after, source }` |
| `ATTACHED`, `DETACHED`                                | `{ attachmentId, filename, mimeType, commentId? }`    |
| `FOLLOWED`, `UNFOLLOWED`                              | `{ users: [{ id, label }], self }`                    |
| `SUBTASK_ADDED`                                       | `{ subtaskId, title }`                                |
| `PINNED`, `UNPINNED`                                  | `{ commentId }`                                       |

`before`/`after` in a field story is a string, `{ id, label }` for a person,
section, status or option, or `{ date, at }` for a scheduled date. `summary`
is always present as the plain-text fallback.

## Errors

| Status | When                                                             |
| ------ | ---------------------------------------------------------------- |
| `400`  | a non-member as a follower; an attachment that cannot be claimed |
| `403`  | editing someone else's comment; pinning or removing without rank |
| `404`  | the item or comment is not in this workspace                     |
| `422`  | an empty body, or a query that fails validation                  |
