# 0014. Stories are filed under the item

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

The task panel needs Asana's activity feed: "moved to In Review", "changed the
due date from Sep 1 to Sep 12", "attached spec.pdf", interleaved with the
comments. The append-only `ActivityLog` already recorded most of these as a
workspace-wide audit feed, but two things stood in the way of reading it per
item:

1. A line was filed under whatever record the write touched. An attachment
   arriving was `CREATED` under `ATTACHMENT`, with the task nowhere in the row.
   The panel's question — "everything that happened to _this_ task" — had no
   index to answer it.
2. A line said what happened only in prose. `summary: 'Updated task "X"'` with
   `metadata: { fields: ['dueDate'] }` cannot be rendered as "changed the due
   date from Sep 1 to Sep 12".

Three shapes were considered for the first problem: a `taskId | ticketId` pair
of columns on `activity_logs`, a separate `stories` table beside the audit
trail, or filing the line under the item and carrying the specific record in
`metadata`.

## Decision

**Stories are filed under the item whose panel shows them** —
`entity: TASK | TICKET, entityId: <item>` — with the attachment, subtask,
comment or field named in `metadata`. The existing `[entity, entityId]` index
answers the panel's question with no new column; the workspace feed keeps
reading `summary` as before.

**Kinds are enum values, not metadata.** `FIELD_CHANGED`, `ATTACHED`,
`DETACHED`, `FOLLOWED`, `UNFOLLOWED`, `SUBTASK_ADDED`, `PINNED` and
`UNPINNED` join `ActivityAction`, because a story's kind is what both the audit
trail and the renderer key on, and a kind hidden in JSON cannot be queried.

**One pure function describes a change.** Every write path builds a snapshot
before and after and hands both to `diffItemStories`, which emits one draft
per property that moved with `{ field, before, after }`. The services, the
shared work-item layer and the automation runner all call it, so "one place
each change is described" is a function rather than a convention each of them
has to remember.

## Consequences

Good:

- no migration touches the audit table's shape; enum values are appended
- the panel and the dashboard read the same rows, so they cannot disagree
- the client renders from values (`before`/`after`) and falls back to
  `summary` for anything it does not recognise, so an old line or a newer
  server's shape still reads as something
- an automation's edit reads exactly like a person's, because it goes through
  the same diff

Costs:

- the audit trail lost `entity: ATTACHMENT` lines for uploads; the file's id
  is in the metadata instead, which is where an audit search now looks
- a bulk edit of a hundred rows writes a hundred stories, as it wrote a
  hundred `UPDATED` lines before — the workspace feed shows them all
- `COMMENTED` lines are filtered out of the item feed at read time rather
  than never written, because the workspace feed still wants them
