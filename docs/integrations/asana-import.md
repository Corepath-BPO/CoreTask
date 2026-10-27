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
no progress for 15 minutes is treated as dead, so another can start.

| Asana                                                                 | CoreTask                                                                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People                                                                | Matched by e-mail. Anyone without an account gets a **placeholder**: an account with no password.                                                              |
| Admin, member, guest                                                  | ADMIN, MEMBER, GUEST in the new workspace (whoever ran it stays OWNER)                                                                                         |
| Team and its people                                                   | Team, TeamMember                                                                                                                                               |
| Project                                                               | Project: name, notes, colour, owner as lead, team, dates                                                                                                       |
| Project privacy                                                       | Public to workspace → PUBLIC; private or team-private → PRIVATE                                                                                                |
| Archived or completed project                                         | ARCHIVED with `archivedAt`, or COMPLETED                                                                                                                       |
| Project members (admin, editor, commenter, viewer)                    | ProjectMember with the same role                                                                                                                               |
| Section                                                               | Section, in Asana's order                                                                                                                                      |
| Task                                                                  | Task: title, notes as rich text, done, assignee, start and due dates and times, milestone or approval                                                          |
| A task in several projects                                            | Home project, plus TaskProject rows for the others                                                                                                             |
| Subtask                                                               | Subtask. CoreTask nests one level, so deeper ones go under the top task (counted as "moved up").                                                               |
| Custom field: text, number, single-select, multi-select, date, people | The same types, with number formats and option colours                                                                                                         |
| Custom field: reference, formula, ID                                  | A text field holding the value Asana displays                                                                                                                  |
| Custom task type ("Ticket")                                           | A tag of that name                                                                                                                                             |
| Tags, followers, likes, dependencies, actual time                     | Tag, Follower, TaskLike, TaskDependency, one TimeEntry                                                                                                         |
| Comment                                                               | Comment, with its author, date, @mentions, pin and likes                                                                                                       |
| System history ("assigned", "marked complete")                        | Not kept                                                                                                                                                       |
| File stored by Asana                                                  | Copied into CoreTask's storage when it is an accepted type within `STORAGE_MAX_FILE_SIZE_MB`; otherwise linked back to Asana under Linked files, and reported. |
| File elsewhere (Drive, Dropbox, a link)                               | Listed under "Linked files" at the end of the description                                                                                                      |
| Status update, portfolio                                              | ProjectStatusUpdate, Portfolio (only portfolios the token's owner owns)                                                                                        |
| Rules                                                                 | Not readable through Asana's API. Rebuild them in Customize › Rules.                                                                                           |

Writes go straight to the database. Imported tasks therefore fire no rules,
webhooks, notifications or e-mails. Anyone who is assigned a task in a private
project joins that project as an editor, so they can open their own task.

## Running it again

`external_refs` maps every imported record to its Asana gid. A run looks each
record up there first: found, the row is updated, and missing, the row is
created and the mapping recorded. A second run therefore never duplicates, and
a run that stopped half way is finished by starting another. Asana's values
win for the fields the import owns. Comments and tasks added in CoreTask are
left alone. Something deleted in Asana is not deleted here.

Each mapping row also keeps the record exactly as Asana last sent it
(`external_refs.snapshot`), every requested field included. Data CoreTask has
no column for can still be mapped later without reading Asana again.

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

A run stopped part way (a deploy restarting the worker) is handed to the next
worker and starts again from the top, updating rather than duplicating. The
early phases take about 20 minutes on that organisation.

## People who were imported

A placeholder account has no password, no sign-in and an unconfirmed address.
Its owner takes it over with "Forgot password", which confirms the address,
so outgoing e-mail has to be working for that. Google and Microsoft sign-in
cannot claim it until then: CoreTask never hands an unconfirmed account to
whoever a provider vouches for by address (see `assertCanClaimByAddress` in
`sso-accounts.service.ts`). Nobody is told they were imported.
