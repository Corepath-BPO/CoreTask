# Importing from Asana

Integrations › Asana copies an Asana organisation into CoreTask: projects,
sections, tasks, subtasks, custom fields and their values, tags, followers,
likes, dependencies, comments, files, teams, status updates and portfolios.

Asana is only read. The client (`api/src/integrations/asana/asana-api.client.ts`)
has no way to send anything but a GET, and the importer never asks it to.

## Setting it up

Two variables in `.env`, passed to both `coretask-api` and `coretask-worker`:

| Variable             | What it is                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ASANA_ACCESS_TOKEN` | A personal access token (Asana › Settings › Apps › Developer apps). It reads whatever its owner can see in Asana. |
| `ASANA_WORKSPACE_ID` | The gid of the Asana workspace or organisation to import.                                                         |

Optional: `ASANA_MAX_REQUESTS_PER_MINUTE` (default 1,200; Asana allows 1,500 on
paid plans and 150 on free ones) and `ASANA_CONCURRENCY` (default 10 requests
in flight; Asana refuses more than 50 concurrent reads).

The token is the server's, not a workspace's. So only people whose CoreTask
e-mail is a full (not guest) member of that Asana workspace may start an
import, and only as an admin of the CoreTask workspace they start it from.

## What a run does

The first run creates a new workspace, `<Asana name> (Asana)`, owned by whoever
started it. Nothing already in CoreTask changes. Every later run must be
started from that workspace (**Sync again**). It updates what the first run
made and adds what is new.

The work happens in the worker (`coretask.import` queue, one run at a time).
The page polls the run's progress every few seconds. A run that has written
no progress for 15 minutes is treated as dead and closed as failed, the next
time the page looks, so **Sync again** is never left disabled by it.

| Asana                                                                 | CoreTask                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People                                                                | Matched by e-mail. Anyone without an account gets a **placeholder**: an account with no password.                                                                                                    |
| Admin, member, guest                                                  | ADMIN, MEMBER, GUEST in the new workspace (whoever ran it stays OWNER)                                                                                                                               |
| Team and its people                                                   | Team, TeamMember                                                                                                                                                                                     |
| Project                                                               | Project: name, notes, colour, owner as lead, team, dates                                                                                                                                             |
| Project privacy                                                       | Public to workspace → PUBLIC; private or team-private → PRIVATE                                                                                                                                      |
| Archived or completed project                                         | ARCHIVED with `archivedAt`, or COMPLETED                                                                                                                                                             |
| Project members (admin, editor, commenter, viewer)                    | ProjectMember with the same role                                                                                                                                                                     |
| Section                                                               | Section, in Asana's order                                                                                                                                                                            |
| Task                                                                  | Task: title, notes as rich text, done, assignee, start and due dates and times, milestone or approval                                                                                                |
| A task in several projects                                            | Home project, plus TaskProject rows for the others                                                                                                                                                   |
| Subtask                                                               | Subtask under its own parent, at every level, as Asana nests them. One an earlier run moved up under the top task goes back under its parent.                                                        |
| Custom field: text, number, single-select, multi-select, date, people | The same types, with number formats and option colours                                                                                                                                               |
| Custom field: reference, formula, ID                                  | A text field holding the value Asana displays                                                                                                                                                        |
| Custom task type ("Ticket")                                           | A tag of that name                                                                                                                                                                                   |
| Tags, followers, likes, dependencies, actual time                     | Tag, Follower, TaskLike, TaskDependency, one TimeEntry                                                                                                                                               |
| Comment                                                               | Comment, with its author, date, @mentions, pin and likes                                                                                                                                             |
| System history ("assigned", "changed the due date")                   | Lines in the task's activity, beside CoreTask's own, credited to whoever made the change (a rule's as an automation), at the time it happened. Top-level tasks, and subtasks whose history is read.  |
| File stored by Asana                                                  | Copied into CoreTask's storage when it is an accepted type within `STORAGE_MAX_FILE_SIZE_MB`; otherwise linked back to Asana under Linked files, and reported. An empty file is skipped and counted. |
| File elsewhere (Drive, Dropbox, a link)                               | Listed under "Linked files" at the end of the description                                                                                                                                            |
| Status update, portfolio                                              | ProjectStatusUpdate, Portfolio (only portfolios the token's owner owns)                                                                                                                              |
| Rules                                                                 | Not readable through Asana's API. Rebuild them in Customize › Rules.                                                                                                                                 |
| Task template                                                         | TaskTemplate in its project's Add menu: name, task name, description, kind, due date (days after it is made), subtask names. One deleted in Asana goes.                                              |
| Project template                                                      | Not copied: Asana's API gives a template's name and team, not its sections or tasks, and seeing those would mean making a project from it in Asana.                                                  |
| Goals, messages, forms, others' My Tasks and portfolios               | Not readable: Asana's API has no route for messages or forms, and answers 403 for another person's My Tasks or portfolio.                                                                            |

Writes go straight to the database. Imported tasks therefore fire no rules,
webhooks, notifications or e-mails. Asana lets anyone in the workspace be
assigned a task, or be named by a rule's checklist, in a project they are not
a member of; CoreTask gives a project's work only to its members and the
workspace's owner. So whoever Asana gives work to in a project joins it as an
editor: the assignee of any of its tasks (on live sync too, as the task comes
across), and anyone the project's active rules assign or hand a checklist
subtask to, once a full run ends.

### How it looks here

- **List view.** Each project's List view is laid out as Asana lays one out:
  Task, Assignee, Due date, the project's fields in Asana's order, then Tags.
  CoreTask's own Priority, Status, Start date and Estimate are left out, since
  Asana has none of them and they would be empty on every Asana task. Widths,
  pins and any other column already there are kept. This happens once per
  project (its `list_layout` ref records which fields it placed); later runs
  only add fields Asana has added since, so a column someone hides or moves
  stays as they left it.
- **Fields from other projects.** Asana keeps a field's value on a task that
  moves on, so a lease in "LEASE PROCESS COMPLETE" still carries the fields of
  "Prepare New Lease". Those values come across like any other, and the task
  panel lists them, read only, under "Fields from other projects" rather than
  making them columns of a project that never used them.
- **Pasted images.** An image pasted into a task's text is one of the task's
  files, though Asana writes no "attached" story for it. The run copies it
  whenever the text embeds one, and the description shows it in place
  (`<img data-attachment>`), once the file has come across.
- **New options.** A value naming an option the field did not have when it was
  read (someone added one since) has the field read again, once per run or per
  live sync pass, instead of the value being cleared.
- **Assignees.** A project's assignee pickers offer its members, as Asana's
  memberships say, and the workspace's owner, who is assignable everywhere.
  The server holds every other way in to the same list
  (`project-access/assignable.ts`): the API, the task panel, rules, Slack and
  templates. A rule's "Assign to" someone outside it fails with a line in the
  run log; a checklist or new task the rule makes is left unassigned instead.
  A task keeps an assignee given before the limit through any other edit.

## Running it again

`external_refs` maps every imported record to its Asana gid. A run looks each
record up there first: found, the row is updated, and missing, the row is
created and the mapping recorded. A second run therefore never duplicates, and
a run that stopped half way is finished by starting another. Asana's values
win for the fields the import owns. Comments and tasks added in CoreTask are
left alone.

A task deleted in Asana is archived here, with its subtasks, never deleted.
After the subtasks, a run asks Asana by gid about every imported task it did
not reach, and archives one only when Asana answers 404. Anything else leaves
the task as it is: a task moved to a project that did not come across is still
there (200), and one moved where the token cannot see is 403. A subtask is
settled by its parent, since Asana answers 403 for a deleted task's subtasks.
The tasks of a project whose list Asana refused that run are not asked about.
Each archived task gets an activity entry, and its mapping row records when
(`external_refs.sourceDeletedAt`). A task restored from Asana's trash is
restored here by the next run. One a person restores in CoreTask while Asana
still has it deleted stays restored. Other records deleted in Asana (projects,
sections, files) are still left in place.

What Asana takes off a task comes off here too. Each write compares the task
with the snapshot the last write kept (below), and removes here what Asana had
then and has no more:

- a tag, including the tag of a custom task type the task no longer is
  (`untagged`);
- a follower (`unfollowed`) or a like;
- a further project the task was taken out of (`unlinked`). Taken out of its
  home project, a task moves home to a project it is still in, and that link
  goes.

Only what was in the snapshot is ever in question, so a tag or a follower added
in CoreTask stays. Snapshots name tags (`tags.name`), so a tag Asana deleted
outright is still found by its name.

A comment Asana no longer lists among a task's stories was deleted there. It is
deleted here the way CoreTask deletes one: kept, marked deleted, with its
mapping row's `sourceDeletedAt` set (`commentsDeleted`). Should Asana list it
again, it is restored; one deleted in CoreTask stays deleted. A subtask that
has comments here has its stories read even when search no longer finds it, so
deleting its last comment in Asana comes across too.

Each mapping row also keeps the record exactly as Asana last sent it
(`external_refs.snapshot`), every requested field included. Data CoreTask has
no column for can still be mapped later without reading Asana again.

## Live sync

Integrations › Asana › **Live sync**, in the workspace that holds the import,
keeps it in step with Asana as Asana changes, rather than at each Sync again.
Changes come across within a minute or two. It is a switch, and only someone
who may import may flip it.

It reads Asana's **event stream** for each imported project (`GET /events`),
which only reads Asana: no webhook is registered there, and nothing in Asana
changes. Webhooks would also need Asana to reach a public address, and Asana
deletes one that cannot be reached for a day, which a stack that is sometimes
switched off would hit.

Every `ASANA_LIVE_SYNC_INTERVAL_MS` (30 seconds), the worker:

1. Reads each project's events since its last token (`asana_event_streams`).
2. Picks out the tasks they name: a changed, added, moved or deleted task;
   the task of a new comment or file; a project whose sections changed.
   Asana's own stories about a change ("changed the due date") come with an
   event on the task and are skipped.
3. Reads each of those tasks again and writes it with the full run's own code
   (`AsanaImportRun.syncTasks`), so a task looks the same whichever brought it.
   A task keeps its place unless it moved, and goes last where it moved to. A
   new subtask goes under its top task. A task Asana answers 404 for is
   archived, as Sync again archives it. A new task in a project that has not
   come across yet waits for the next full run, which brings the project.
   Its stories are read too, one more request, for Asana's record of what
   changed; its comments and files are written again only when the events
   were about those. What Asana took off a task comes off as a full run takes
   it off. A deleted
   comment's event that names its task has the task's stories read again; one
   that does not, or a comment Asana answers 404 for, is found by its mapping
   row and deleted.
4. Reads again a project whose own events say its details, fields or members
   changed (`AsanaImportRun.syncProject`). Its record is written only when it
   differs from the one its mapping row kept.
5. Every `ASANA_LIVE_DEFINITIONS_INTERVAL_MS` (5 minutes), looks at the
   workspace's custom fields, tags and projects, which Asana sends no events
   for (`AsanaImportRun.syncDefinitions`). Each is compared with the record its
   mapping row kept, key by key, and only what differs is written: a field's
   new name or options, a tag renamed or recoloured (tags now have mapping
   rows, so a rename renames rather than making a second tag), a project's
   details. A new project comes across with its tasks, subtasks, comments and
   files, its event stream opened first so nothing done to it meanwhile is
   missed. A task already here from another project keeps its home and gains
   the new one. About ten requests when nothing changed.
6. Tells open boards, task panels and project pages, through the worker's
   realtime relay: a new project appears in lists, and a changed one's page,
   roster and fields refresh, as does every project using a changed field.
   As with an import, no CoreTask rule fires (Asana's already ran) and nobody
   is notified.

A full Sync again backs it up. Asana's events are at-most-once, and a stream's
token lapses after 24 hours, so one runs:

- when live sync is switched on, after every stream has its token, so nothing
  that changes during the run is missed;
- whenever a token has lapsed: the worker was off for a day, say;
- every night, at `ASANA_FULL_SYNC_CRON` in `ASANA_FULL_SYNC_TZ`
  (3 AM, America/Chicago).

Ticks and runs share the import queue, which does one job at a time, so live
sync never writes while a full run does; it picks up after.

What live sync leaves to the full run: a new team, a project-local field the
workspace's list leaves out, a field taken off a project, and tasks moved into
or out of a project that did not come across. A tag a task names that live
sync has not seen yet is read from Asana on the spot.

## Size and time

Asana has no count of a task's comments or files, so finding them means reading
a task's stories, one request per task. Asana's cost limit bites hardest on
that endpoint: in practice it answers about 200 a minute, with 429s telling the
client to wait 20–40 seconds, whatever the plan's nominal 1,500.

So every top-level task's stories are read, but a subtask's only when Asana's
search says it has a file (`has_attachment`) or a comment by someone in the
workspace (`commented_on_by.any`). On texasrenters.com that read 11,808 tasks'
histories instead of 112,000 (100,378 rule-made checklist subtasks had
neither): about an hour instead of most of a day. Search needs a paid Asana
plan; without it, every subtask's stories are read. A subtask whose only
comment is from someone no longer in the Asana workspace is the one case
search misses.

A request whose connection drops is tried again for about a minute and a half
(a 5xx, which is Asana answering, three times). Only Asana refusing search
switches it off; a search that still cannot be reached after that ends the run
with "Asana search did not answer", and **Sync again** finishes it, rather than
the run spending most of a day reading every subtask.

A run stopped part way (a deploy restarting the worker) is handed to the next
worker and starts again from the top, updating rather than duplicating. That
holds when the worker shuts down cleanly too: the run cannot record its outcome
once the database is closed, so its job is tried again 30 seconds later. The
early phases take about 20 minutes on that organisation.

## People who were imported

A placeholder account has no password, no sign-in and an unconfirmed address.
Its owner takes it over in either of two ways:

- **Google or Microsoft sign-in**, with the same address. CoreTask hands an
  unconfirmed account to whoever a provider vouches for only when nobody can
  sign in to it, which a placeholder is (see `assertCanClaimByAddress` in
  `sso-accounts.service.ts`). Signing in confirms the address.
- **"Forgot password"**, which confirms the address too, once outgoing e-mail
  is working.

Nobody is told they were imported. Once the account has a password or a
connected sign-in, the exception no longer applies to it.
