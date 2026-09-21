# Comments and collaboration

What a task or ticket's panel shows beneath its fields — collaborators, files,
stories and the thread — and the rules that keep the four honest with each
other. For descriptions, dates and the rich-text pipeline the thread reuses,
see [task-dates-and-rich-text.md](task-dates-and-rich-text.md).

## Collaborators

`Follower` is one row per person per item, in the `taskId | ticketId` shape a
comment or an attachment uses. It is what Asana calls the task's
collaborators, and it is the **only** list a comment or a change notification
fans out to.

People join it two ways:

| Silently, by `FollowersService.ensure`         | Deliberately, with a story                  |
| ---------------------------------------------- | ------------------------------------------- |
| creating the item                              | the panel's "+" (`FOLLOWED`)                |
| being assigned (by a person or a rule)         | "Leave task" / a manager's × (`UNFOLLOWED`) |
| commenting                                     |                                             |
| being mentioned, in a comment or a description |                                             |

`ensure` filters to current workspace members and never records a story —
Asana does not announce that the assignee now follows the task. Removing a
member from the workspace deletes their rows in the same transaction that
unassigns their open work.

There is deliberately no tombstone. Asana re-adds you the next time you are
assigned or you comment, so "left" needs no memory: leaving stops the
notifications until the next thing that would have subscribed you anyway.

The routes hang off the item: `GET`/`POST /tasks/:id/followers`,
`DELETE /tasks/:id/followers/:userId`, and the ticket twins by UUID or key.
Anyone may remove themselves; removing somebody else needs MANAGER.

## Who gets told

`CommentsService` used to compute watchers on the fly — assignee, creator,
prior commenters. That set is now persisted as followers, and the rules are:

- **Mentioned wins.** Being named gets `MENTIONED`; the same comment never
  also sends `COMMENT_CREATED` to that person.
- Everyone else following gets `COMMENT_CREATED`, minus the author.
- A field change reaches followers through `FollowerNotifier`, and only for
  the changes worth an inbox line: completion (or a ticket's status), and the
  due date. A rename or an edited description is in the feed for anyone who
  opens the panel; pinging every follower for it would train people to ignore
  the inbox. One notification per follower per write, however many properties
  moved together.
- A custom field flagged "notify collaborators" sends `FIELD_CHANGED`
  (see [custom-field-system.md](custom-field-system.md)).

## Stories

The activity trail always existed as a workspace-wide audit feed. The panel
needs the same lines _per item_, readable as prose. Two things changed:

**Stories are filed under the item.** An attachment arriving is `ATTACHED`
with `entity: TASK, entityId: <task>` and the file's id in the metadata — not
`CREATED` under `ATTACHMENT`. The existing `[entity, entityId]` index then
answers "everything that happened to this task" without a new column, and the
workspace feed still reads it through `summary`. `GET /activity/item` pages
that list newest first by id (UUID v7, so the cursor is exact), leaving out
`COMMENTED` lines — the comment itself is in the thread — and `ATTACHED` lines
for files that were posted _with_ a comment, which that comment shows.

**One function describes a change.** Every write path — the task service,
the ticket service, the shared work-item service the List and Board use, and
the automation runner — builds an `ItemSnapshot` before and after and hands
both to `diffItemStories`. It emits one draft per property that moved, with
`FieldStoryMetadata` (`field`, `before`, `after`) so the client can say
"changed the due date from Sep 1 to Sep 12" from the values rather than
parsing prose. `summary` stays as the fallback for a reader that does not
know the shape. Kinds that are not a diff (`FOLLOWED`, `SUBTASK_ADDED`,
`PINNED`, `FIELD_CHANGED`) write their own metadata shapes, all declared in
`packages/contracts/src/activity-stories.ts`.

A task going to DONE reads as "marked complete", not also as a status change
— status _is_ completion for a task. A ticket keeps its status story instead,
because Open → Triaged → Resolved is what somebody wants to see.

The client renders every story through `describeStory`; the thread merges
them with the comments by time and offers Asana's "All activity / Comments
only" switch, remembered per browser.

## The thread

Comment bodies are the same sanitised HTML a description holds, through the
same editor and the same `sanitize-html` allow-list. Rows written before that
— plain text with `@[Name](uuid)` tokens — are **converted on read** by
`commentBodyToHtml`, never rewritten in place: the audit trail keeps what was
posted. The server indexes mentions from either shape (`parseAnyMentionIds`),
so an old client, or a rule's ADD_COMMENT action, still produces a mention.
Notification bodies are the words only (`htmlToText`); a comment that is just
a picture says "(image)".

Files posted with a comment are uploaded to the item while composing — the
comment does not exist yet — and _claimed_ at post time through
`attachmentIds`. Only the author's own confirmed files on this item, not yet
shown by another comment, in one transaction with the comment, so a refused
claim leaves no comment behind. The file stays the item's: it is in the
panel's strip, counts against the item's cap, and survives the comment being
deleted (`Attachment.commentId` is `SetNull`).

Paging is a `before` cursor over ids, latest window first: offsets would
repeat a line whenever a reply landed between two requests. The pinned
comment — one per thread, author or MANAGER — rides in the first window
whatever its age, because the top of the thread is where it is shown.

Likes are a `(commentId, userId)` row; the DTO carries the count, whether the
reader liked it, and the first few names. Socket payloads are emitted without
a viewer, so `likedByMe` is always false in them; clients treat `comment:*`
events as "refetch", never as a cache write.

Rows and cards carry `commentCount` and `attachmentCount` — live comments and
confirmed files — through the same filtered `_count` the subtask rollup uses.
