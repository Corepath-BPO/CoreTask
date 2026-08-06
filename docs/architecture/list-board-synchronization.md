# Keeping List and Board in step

Three mechanisms, in order of how often they carry the weight: the shared cache
key, the mutation's invalidation, and the socket.

## 1. One cache key

```ts
queryKeys.workItems.all(workspaceId, projectId);
queryKeys.workItems.list(workspaceId, projectId, query);
queryKeys.workItems.detail(workspaceId, projectId, workItemId);
```

Both views read `useProjectWorkItems`, so within one tab they are the _same_
cache entry. Switching tabs shows the same rows because there is only one set of
rows. This is what makes most of the synchronisation problem disappear rather
than get solved.

## 2. Mutations invalidate everything that draws the project

`invalidateProjectWork` invalidates three families, not one:

| Family         | Read by                                         |
| -------------- | ----------------------------------------------- |
| `workItems`    | List and Board, via the shared query            |
| `tasks`        | task detail dialog, My Tasks, dashboard rollups |
| `projectViews` | field metadata, saved view settings, subtasks   |
| `projects`     | project cards and headers, which show counts    |

Invalidating only its own family is the original bug: the Board and the List
kept the same rows under unrelated keys, so a mutation refreshed one and left
the other showing the previous answer. The extra families come out as each
consumer moves onto `workItems`, and not before.

`invalidateProjectSections` does the same for sections, and exists for the same
reason: the Board reads them from the project detail, the List from field
metadata, and for a while only _rename_ invalidated both — so adding, deleting
or reordering a section updated one view and not the other.

## 3. The socket, for other people

`useProjectRealtime` is mounted once on the project page — not per view, so
switching between List and Board does not leave and rejoin the room, and a
change arriving mid-switch is not missed by both.

```
work-item:created   ┐
work-item:updated   ├─ project room ─→ useProjectRealtime ─→ invalidate
work-item:moved     │
work-item:deleted   ┘
section:*           ── workspace room, filtered by projectId
```

Events are named for the domain change, never the screen. There is deliberately
no `board:*` or `list:*` event: both views react to the same fact, and an event
per screen is how they drift apart again. The legacy `task:*` and `ticket:*`
events still fire so nothing already listening breaks.

**Joined on every `connect`, not once on mount.** A socket.io room is
per-connection: a reconnect after a dropped network silently leaves every room,
and a tab that joined once would go quiet for the rest of its life while looking
perfectly healthy. Reconnecting also refetches — events that arrived while the
socket was down are gone, so the cache is of unknown age.

## Correlation ids

Every mutation stamps one; the server echoes it on the broadcast; a client that
recognises its own ignores the event.

Without it each edit costs two requests — the mutation's invalidation, then the
echo's — and the grid flickers between the two answers. Measured on the running
app:

|                             | requests                |
| --------------------------- | ----------------------- |
| This client creates an item | 1 POST + 1 GET          |
| Another client creates one  | 1 GET, socket-triggered |

The ring holds 64 ids and is non-destructive on read: the same id arrives more
than once (a create emits both `work-item:created` and the legacy
`task:created`), and consuming it on the first would make the second look like
somebody else's change.

## Why invalidate rather than patch

The payload carries the whole item, and writing it straight into the cache would
be faster. But both views also show counts, section rollups and a progress bar
derived from the whole set, and none of those can be recomputed from one row.
Refetching is the honest answer to "something over there changed".

## What is not covered

Optimistic insertion. A created item appears after the round trip, not before.
The round trip is fast enough locally that adding optimistic rows would mostly
add reconciliation bugs — the temporary id has to be swapped for the real one,
and the socket echo has to not draw it twice. Worth doing when the latency
justifies it, and not before.

## See also

- [One dataset, two views](./project-views-shared-data.md)
- [Project work items](./project-work-items.md)
