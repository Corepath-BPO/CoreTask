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
| Subtask                                                               | Subtask. CoreTask nests one level, so deeper ones go under the top task (counted as "moved up").                                                                                                     |
| Custom field: text, number, single-select, multi-select, date, people | The same types, with number formats and option colours                                                                                                                                               |
| Custom field: reference, formula, ID                                  | A text field holding the value Asana displays                                                                                                                                                        |
| Custom task type ("Ticket")                                           | A tag of that name                                                                                                                                                                                   |
| Tags, followers, likes, dependencies, actual time                     | Tag, Follower, TaskLike, TaskDependency, one TimeEntry                                                                                                                                               |
| Comment                                                               | Comment, with its author, date, @mentions, pin and likes                                                                                                                                             |
| System history ("assigned", "marked complete")                        | Not kept                                                                                                                                                                                             |
| File stored by Asana                                                  | Copied into CoreTask's storage when it is an accepted type within `STORAGE_MAX_FILE_SIZE_MB`; otherwise linked back to Asana under Linked files, and reported. An empty file is skipped and counted. |
| File elsewhere (Drive, Dropbox, a link)                               | Listed under "Linked files" at the end of the description                                                                                                                                            |
| Status update, portfolio                                              | ProjectStatusUpdate, Portfolio (only portfolios the token's owner owns)                                                                                                                              |
| Rules                                                                 | Not readable through Asana's API. Rebuild them in Customize › Rules.                                                                                                                                 |

Writes go straight to the database. Imported tasks therefore fire no rules,
webhooks, notifications or e-mails. Anyone who is assigned a task in a private
project joins that project as an editor, so they can open their own task.

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
sections, comments, files) are still left in place.

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
4. Tells open boards and task panels, through the worker's realtime relay.
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

What live sync leaves to the full run: new projects, project details, tags and
custom field definitions, and tasks moved into or out of a project that did not
come across.

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
