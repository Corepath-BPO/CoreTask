# Task dates, times and rich text

Three things a task panel in Asana does that ours did not: a due date can carry
a time of day, a task can have a start date beside its due date, and the
description is formatted text rather than a plain box. This documents the shape
each of those took and why.

## Dates are calendar dates; times are instants

A task's start and due are each a **pair** of columns:

| Column      | Holds                                            | Null means  |
| ----------- | ------------------------------------------------ | ----------- |
| `dueDate`   | The calendar date, stored at UTC midnight        | No due date |
| `dueAt`     | The exact instant, when a time of day was chosen | All day     |
| `startDate` | As above                                         | No start    |
| `startAt`   | As above                                         | All day     |

This is the shape Asana's API uses (`due_on` / `due_at`) and it was chosen for
the same reason: every reader that only ever cared about the _day_ — the
calendar page, the "overdue" rollup, the automation condition "due date is
before…", the list's sort — keeps reading `dueDate` and never changes. A time is
additive. Folding the time into the one column would have forced every one of
those readers to decide, per row, whether a clock was meaningful.

### The rules the pair follows

`resolveSchedule` in `api/src/common/utils/schedule.util.ts` is the single
place these live, and both the task endpoint and the work-item endpoint go
through it:

- **Clearing the date clears the time.** A time of day on no day is nothing.
- **A time on no date is refused** with a 400, not dropped. The caller believed
  it saved something.
- **Moving the date carries the time across.** Push a 3 PM task from Friday to
  Monday and it is due Monday at 3 PM. The offset from UTC midnight stands in
  for the wall clock; it drifts by an hour only across a daylight-saving change.
- **Every date is normalised to UTC midnight on write**, whatever clock arrived
  with it. The `SET_DUE_DATE` automation used to stamp the moment it ran; the
  migration that added the columns truncated every existing date once.

### Overdue

A task with a time is late the moment that instant passes. One without is late
only once its calendar day is over. The rollup in `TasksService.summarize` and
`isOverdue` in `web/src/lib/utils/dates.ts` apply the same rule; before this,
comparing the date column against "now" made a task due today overdue from a
minute past midnight UTC — seven in the evening the day before, in Texas.

### Reading a calendar date in the browser

`new Date('2026-09-05T00:00:00.000Z')` in a timezone west of Greenwich is the
evening of the fourth, and every due date in the app rendered a day early for
anyone in the Americas. `asLocalDate` in `web/src/lib/utils/format.ts`
recognises the calendar-date shape and rebuilds it from its year, month and day
at local midnight; `formatDate`, `daysUntil` and `formatDueDate` all go through
it. An instant with a clock — `createdAt`, a `dueAt` — is left alone.

The client keeps the pair consistent: whenever it sends a `dueAt`, it sends the
`dueDate` that instant falls on locally.

### The picker

`TaskDatePopover` is Asana's date picker: two fields on top that say which end
the calendar is filling, the month grid, then "Add time" and "Set to repeat".
Every choice saves at once, as the rest of the panel does. The same component
hangs from the panel's Due date row, the list's Due date and Start date cells,
and a subtask's tail, so the four places cannot disagree about what a click
does. "Set to repeat" is shown disabled — recurring tasks are not built, and the
row says so rather than being missing.

Tickets keep a date-only deadline: no start, no time, and the picker knows it.

## Descriptions are sanitised HTML

The description is a Tiptap editor (`web/src/components/forms/rich-text-editor.tsx`)
with the marks and blocks Asana's description offers and nothing beyond them:
bold, italic, underline, strikethrough, lists, links, inline code, two heading
sizes, a quote. Its output is HTML, and HTML is what the `description` column
now holds — for tasks and tickets alike, since the task panel serves both.

Storing markup other people's browsers will render is exactly the shape of a
stored XSS, so **nothing reaches the database without passing through
`normalizeRichText`** in `api/src/common/utils/rich-text.util.ts`. It is an
allow-list sanitiser (`sanitize-html`, pinned to 2.17.1 — the last release
whose parser Jest can load): the editor's tags, `href` on links restricted to
`http`, `https` and `mailto`, every link forced to `target="_blank"
rel="noopener noreferrer"`, and no attributes, styles, classes or ids
otherwise. Scripts and their contents are dropped. The client sanitising too
would be a courtesy, not a defence.

The same function handles the seam with the past. Every description written
before the editor existed is plain text with newlines, and a CSV import or the
ticket form's textarea still sends that shape. Plain text becomes one paragraph
per line on the way in; `looksLikeHtml` decides which is which by looking for
the editor's own tags, so a stray `<` in "a < b" stays text. Legacy rows that
were never rewritten get the same treatment on the way _out_, in
`toEditorHtml`, and the editor never renders anything except through
ProseMirror's parser — which keeps nothing outside its schema.

An emptied editor, whitespace, and markup with no text in it all store as
`null`, so "no description" means one thing to every reader. The size limit
grew from `DESCRIPTION_MAX_LENGTH` to `RICH_TEXT_MAX_LENGTH` (20,000) because
markup costs characters.

## Mentions in the description

Typing `@` in the description opens the same picker the comment composer has,
and a chosen name is stored as `<span data-mention="uuid">@Name</span>` —
exactly the attribute the comment chip renders, so one style rule and one
entry in the sanitiser's allow-list cover both. A `span` wearing anything
else is unwrapped to its text; a `data-mention` that is not a uuid is
unwrapped too.

Notifications follow the comment rule: being named is a stronger signal than
being subscribed, and only the people an _edit adds_ are told, so fixing a
typo does not re-ping everyone already there. A comment keeps a join table
for that; a description is diffed instead (`DescriptionMentionNotifier` in
`api/src/integrations/notifications/`), because the previous markup is
already in hand wherever it is rewritten — the task and ticket services and
the shared work-item service all call it. Only current workspace members are
told, whatever the markup names. The chip itself stays in the text either
way, greyed for nobody in particular, as a comment token does.

## Pictures in the description

A pasted, dropped or picked raster image becomes an attachment first, under
the attachment rules (type, size, the per-item cap), and then a picture where
the caret was. It is stored as `<img data-attachment="uuid" alt="filename">`
— **never a `src`**. The bucket is private and every link to it expires, and
the API is bearer-token only, so a URL in stored markup would be dead the
next time anyone read it. Instead the editor's node view asks
`GET /attachments/:id/view` for a short-lived inline URL when the picture is
looked at, caches it for a little less than its lifetime, shows a skeleton
while it loads and an honest "image unavailable" once the attachment is gone.
The sanitiser drops an `img` with any other attribute, or with no valid id.

The view route serves raster images only. An SVG is an accepted upload, but
rendered from the storage origin it can carry script, so it stays a download.

The attachment also stays in the attachments strip, as Asana's inline images
do; deleting it there leaves the placeholder in the text.

## Comments share the pipeline

A comment body is stored the same way: the same editor, the same
`normalizeRichText` allow-list, the same `data-mention` chip and
`data-attachment` picture. `normalizeCommentBody` adds one seam — a body
that is still plain text with `@[Name](uuid)` tokens becomes the chip markup
first — and `commentBodyToHtml` applies the same conversion on the way out for
rows written before comments were rich text. See
[comments-and-collaboration.md](comments-and-collaboration.md).

## What this deliberately does not do

- **Recurring tasks.** The picker's "Set to repeat" row is there and disabled.
- **A start time without a due time.** A range from "the 1st" to "the 5th at
  3 PM" is lopsided; the start time control appears once the due has one, as
  Asana's does.
