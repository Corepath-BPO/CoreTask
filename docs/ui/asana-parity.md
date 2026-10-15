# Asana parity

What Asana offers, what CoreTask matches, and what is still open. Written
against a live Asana workspace (October 2026) and the `coretask/asana-parity`
branch.

## Shell

| Asana                                                    | CoreTask                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Search box with type chips, recents, saved searches      | Global search (Ctrl/⌘ K, `/`) — tasks, tickets, projects, people; kind chips; recents; **Advanced search** with saved searches |
| Red **Create** menu: task, project, message, team, goal… | Create menu: task (quick add, also Tab+N), project, ticket, portfolio, **goal**, **message**, team, invite                     |
| Sidebar: Home, My tasks, Inbox, starred projects         | Same, with **Starred** projects and **Saved searches**                                                                         |
| Strategy rail: Goals, Reporting, Resourcing              | **Goals** with status updates; **Reports** with dashboards; workload by portfolio and by project                               |

## Projects

| Asana tab        | CoreTask                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview         | Progress, sections, dates, lead, description, **key resources** (links), **milestones**, **portfolios**, project roles, connected goals, recent activity                                                                                                                                                      |
| Note / Page      | **Note**: one rich-text document per project, saved as editors type (and on leaving it), with who edited it last                                                                                                                                                                                              |
| List             | Filter/Sort/Group/Options (group by section, status, priority, assignee, **due date** — overdue, today, tomorrow, this week, next week, later — or a field; dropping a row under a date heading sets that date), saved views with a **view picker** (rename, duplicate, default, delete), bulk bar, shortcuts |
| Board            | Same toolbar and view picker                                                                                                                                                                                                                                                                                  |
| Timeline / Gantt | **Timeline**: day scale (days/weeks/months), drag to move, drag ends to change dates, click a lane to schedule; **dependency arrows** (red when the waiting task starts too early), drawn by dragging a bar's dot onto the task that should wait                                                              |
| Calendar         | **Calendar**: month grid, start–due bars, drag to reschedule, add on a day, Unscheduled tray                                                                                                                                                                                                                  |
| Dashboard        | **Dashboard**: totals, completion meter, open work by section and by assignee, burn-up                                                                                                                                                                                                                        |
| Workload         | **Workload**: open work by person and the week it is due (overdue, six weeks, later, undated), in tasks or estimated hours; a cell lists its tasks, and an editor **drags** one to another person (reassign) or week (reschedule, same weekday, start and times moved with it)                                |
| Workflow / Rules | Automations — see **Rules** below                                                                                                                                                                                                                                                                             |
| Activity         | **Activity** feed for the whole project, grouped by day                                                                                                                                                                                                                                                       |
| Messages         | **Messages**: posts with replies, beside the project's status updates; members are notified                                                                                                                                                                                                                   |
| Files            | **Files**: every finished upload on the project's tasks, with the task it is on                                                                                                                                                                                                                               |
| (Settings)       | **Settings**: details, the task statuses (rename, recolour, category, reorder, archive, delete), priorities, archive                                                                                                                                                                                          |

## Rules

The builder's trigger, condition and action pickers use Asana's wording, and
every row the engine can run is enabled.

- **Triggers added:** _Rule is run manually_ (a **Run rule** submenu in the
  task's "…" menu and on the list's selection bar, with a 30-character menu
  label), _Scheduled time occurs…_ (daily, weekdays, weekly, monthly at a time,
  in a timezone, with Asana's execution scope — no tasks, all, incomplete, a
  section, untouched for N days — and a "Next run" line), _Due date is
  approaching_, _Task is overdue_, _Start date is approaching_, _Start date has
  passed_, _Task is no longer blocked_, _Attachment is added_, _Collaborator is
  added_, a custom date field's _[Field] is approaching_ and _[Field] is
  overdue_ (one row per date field, or the generic row with a field picker),
  and the _Section is not…_ / _Section is one of…_ forms of the move trigger.
- **Actions added:** change completion status, remove from the project, create a
  task, add or remove collaborators, set the task name, set the description.
  Text actions (and comments) take variables — `{{task.name}}`,
  `{{task.assignee}}`, `{{task.due_date}}`, `{{project.name}}`,
  `{{triggered_by}}`, `{{today}}` — from an **Insert variable** menu. So do
  the titles of the subtasks a rule creates, from each row's **+** menu.
- **Move task to another project** has Asana's second option, **Add task to
  another project**: the task stays here and shows in that project too
  (multi-homing), in the section chosen. Running it again changes nothing.
- **Send an email** e-mails the assignee, the collaborators or whoever created
  the task (members only, never a typed address) with a subject and message
  that take variables, plus a link to the task and the rule's name.
- **Conditions added:** task has an attachment, task has a comment, task is no
  longer blocked.
- The clock runs on the worker once a minute. A schedule is claimed with a
  cursor and a date firing with a unique row, so nothing runs twice; a run
  missed by more than an hour is skipped rather than fired late.
- Task types and approvals are rule material too: _Task type is changed_,
  _Approval status is changed_, a check on each, and _Set task type_.
- **Ticket rules:** _Ticket is reported_ and _Ticket status changes_ (to any
  status, or to one) start rules that act on the ticket. They check its type,
  priority, severity, status or assignee. They can set its status or priority,
  assign or unassign it, move it to a section, set or clear its due date,
  comment, notify, email its people, change its collaborators, or create a task
  from it ("Fix {{task.name}}" names the ticket). The builder greys out the
  steps that belong to the other kind of rule, and publishing refuses them.
  Setting a ticket's status raises _Ticket status changes_ for the next rule.
- **Wait…** pauses a rule for 1 minute to 90 days before the steps after it.
  What comes before runs at once; the clock picks the run up once the time
  has passed and judges what follows on the task or ticket as it is by then.
  So _Wait 2 days → Task is incomplete → Add comment_ nudges only if nobody
  finished it. The rule's log says when it will continue. A run whose rule
  was paused in the meantime is cancelled, and one whose wait step was edited
  away is skipped. Webhooks fire once, for the event, not again on resuming.
- **AI steps**, once the server has an Anthropic key (`ANTHROPIC_API_KEY`;
  without one both stay greyed with that reason):
  - **Use AI…** takes instructions and a list of what AI may do — comment,
    assign, move to a section, change status or priority, set the due date,
    create subtasks, fill in chosen custom fields. The model reads the task
    (fields, description, subtasks, recent comments) and picks from this
    project's own sections, statuses, people and options. Its choices run as
    the ordinary actions, so history, notifications and follow-up rules behave
    as if the author had added them. The run's log lists what it changed and
    its one-line reason. Anything it suggests outside the ticked list is
    ignored and counted. Its comments end "— Written by AI for the rule …",
    since a rule's comment is posted under whoever set the rule off.
  - **Create conditional check with AI** asks a yes-or-no question. The rule
    goes on only on a yes; a no is logged as a skip with the model's reason,
    and a check that could not be asked fails the run instead of skipping.
    Only the rows a run reaches are asked.
  - Task rules only. Task text is treated as data, never as instructions.
- Still greyed, with reasons: "Draft an update with AI…" and "Let AI decide
  the number of subtasks" (a Use AI… step that may create subtasks does it).

## Project templates and duplicates

A project's menu has **Duplicate project** and **Save as template**, and the
projects page has **Use a template**. Both take the sections and, as chosen,
tasks (with subtasks, assignees and dates), fields, rules, task templates and
members. A duplicate keeps where every task was; a template's tasks start open,
without people by default, and their dates are kept as days from the project's
start, so each project started from it counts them from its own start date.
Rules are matched to the new project's sections and fields by name and are
live again where they validate; someone who may not manage rules gets the rest
and is told.

**Export to CSV**, in the same menu and open to anyone who can see the project,
downloads Asana's columns: Task ID, dates, name, section, assignee and email,
start and due dates, status, priority, tags, notes (as plain text), every
project the task is in, and its parent, then one column per custom field
(formulas worked out). Subtasks come straight after their parent. Text that a
spreadsheet would run as a formula is saved with a leading `'`.

## Customize

The project's **Customize** panel lists Asana's rows; the built ones open in
place.

- **Rules** and **Fields** — see above and the custom field docs.
- **Forms**: intake forms with their own unguessable link. Each asks for a
  title and details, then its own questions (short answer, paragraph, email,
  single or multiple choice from its own options, date, number; required or
  not), each answer checked for what it should be. Anyone with the link can submit, without an account; each
  response becomes a task in the chosen section (the first by default),
  credited to the form's author, with every answer written into the
  description. A form can be closed (the link then reads as not taking
  responses), reopened, edited or deleted, and shows its response count. The
  public endpoints are throttled like sign-in.
- **Task types and templates**: ready-made tasks with their type, assignee,
  due offset and subtasks, used from the panel or the Add menu.
- **Status templates**: a status update's starting point — a status to begin
  on, a Summary and Next steps. The status composer's **Use a template** menu
  fills them in; nothing is posted until its author posts.
- **Bundles**: a project's sections, fields, rules and task templates (or the
  parts chosen), packaged for other projects. Adding one to a project adds the
  sections and fields it lacks and writes the bundle's rules and templates in,
  with section and field references matched by name; a rule that was live in
  the source is published where it validates and named where it does not.
  **Send changes out** retakes the bundle from its project and syncs every
  project the sender manages; others show _Update available_ and **Sync**.
  Removing a bundle from a project takes its rules and templates and leaves
  its sections and fields; deleting a bundle leaves everything it wrote, as
  the projects' own. Bundle-written rules say _From a bundle_ in the list.
- **Emails**: Asana's **Add tasks via email**. Each project has an address to
  copy; mail sent to it becomes a task (subject as title, body as description,
  files as attachments) in the chosen section, and replying to a task's update
  email adds a comment, without the quoted message. The two checkboxes are
  Asana's: **Send recipients task updates automatically** (outside addresses
  on From, To and CC are sent the task's comments, with a reply address) and
  **Add members as task collaborators** (members on the email follow the
  task). Under them: whether the address is taking mail, who may write
  (members only, or anyone — a stranger's task is credited to whoever set the
  address up and says who sent it), where new tasks land, **Get a new
  address**, and the last emails received with what became of each. A mail
  provider delivers to the API; see _Inbound e-mail_ in the backend docs.
- **Apps**: Asana's "Get started with apps" — a gallery of Slack, Microsoft
  Teams, Google Chat and Discord. **Add** asks for the channel's incoming
  webhook URL (with where to find it), a name, and what to post: tasks added,
  completed, assigned, moved, due dates, comments. The channel gets a hello at
  once, then each update as that tool's own message (Slack blocks, a Teams
  card, Google Chat text, Discord markdown) linking to the task. Each
  connection shows what it posts and how its last post went, with a switch,
  **Send a test message**, Edit and Disconnect. Project editors manage them;
  the URL must be the tool's own webhook address. Underneath, an app is a
  webhook endpoint scoped to the project, so it retries, keeps a delivery log,
  switches itself off after repeated failures, and appears in the admin's
  webhook list marked as an app.
- Every Customize row is built now; none is marked _Soon_.

## Connecting other tools

Asana's developer console and OAuth, and its webhooks API:

- **Integrations › OAuth apps** registers an app: name, description, website,
  redirect URIs; the client id and a once-shown secret. Anyone can register
  one; it acts only for people who allow it.
- A tool sends a person to **/oauth/authorize**. They see the app, who made
  it, what it can do and where they will be sent, and **Allow** or **Cancel**.
  The tool trades the code for an hour-long access token and a refresh token.
- **Integrations › Connected apps** lists the apps a person allowed, with
  **Disconnect**. The tab and OAuth apps are open to every member; API keys,
  Webhooks and Playground stay with admins.
- API keys and apps can **subscribe webhooks** to a project through the API
  and remove them; Settings › Webhooks shows them as "Added by …".
- See `docs/architecture/oauth-and-connectors.md` for the flow and its rules.

## Task pane

Matched: assignee, dates with times, **status and priority rows**,
**dependencies** (blocked by / blocking, loop-guarded), projects/section,
custom fields, rich-text description, subtasks (with **copy link / open in new
tab**), collaborators, attachments, comments with likes and pins, All activity
/ Comments switch, **task likes**, **full screen**, **"…" menu** (duplicate,
copy link, open in new tab, archive).

**Set to repeat**: daily, weekly on chosen days, monthly, yearly, or N days
after completion. Completing the task — from the pane, the list or a rule —
creates the next one once, carrying its fields, collaborators and subtasks.
It is set from the pane's Repeats row or from the due-date picker.

**Milestones and approvals**: added from the project's Add menu or converted
from the "…" menu. A milestone is a diamond on the list and the timeline; an
approval is answered with Approve, Request changes or Reject, and approving or
rejecting completes it. Rules can watch both ("Task type is changed",
"Approval status is changed"), check them, and convert a task.

**Mark as duplicate** from the task's "…" menu: find the task it repeats; this
one is completed, says "This task is a duplicate of …" with a link and Undo,
and its collaborators join the original so nobody stops hearing about the work.

**Create follow-up task** from a task's or a subtask's menu: a new task beside
it, due a week out, with a comment on the original.

**Multi-homing**: a task can be in several projects. The pane's **Projects**
block lists its home with its section, every other project with its own
section there, and **Add to project**; any of them can be removed (leaving
the home promotes the project it joined first). Each board shows the task in
its own section and place, so a drag on one board leaves the others alone.
The task is visible — and editable — through any project the reader can
open, so a task filed in a private project can be shared into a public one.
Project, section, goal and portfolio counts include linked tasks; a linked
project's rules answer the task's changes and act on that board (a rule's
"move to section" moves its card there, "remove from project" takes it off
that board only); a repeating task's next occurrence keeps its projects; and
a linked project's fields can be set on it.

**Tags**: workspace-wide labels any task can carry, in any project. The pane's
**Tags** row finds a tag as you type or makes one from the name (unique
whatever its case, coloured in turn); each chip comes off with its ×. Tags
show on Board cards and as a List column, filter a view ("is any of", "is none
of", empty), filter advanced search, and are managed under Settings › Tags —
rename, recolour, delete (by whoever made it or a manager), each with its count
and a link to its tasks. Guests read tags but do not make them.

**Time tracking**: the pane's **Time** row shows what has been logged against
the estimate (red once it is over), sets the estimate the way a person writes
it ("2h", "90", "1h 30m"), and logs time by hand or with a timer that survives
closing the pane. Each entry has a day and a note; anyone who can edit the task
logs time, guests read it, and an entry is changed or removed by its author or
a manager.

Open: subtasks under tickets.

## Home

Home is customizable per person and workspace: **Customize** lists the
widgets — task overview, ticket health, assigned to you, upcoming deadlines,
project progress, recent activity, recent tickets and a **private notepad** —
to show, hide and reorder, with a reset. The layout and the notepad are kept
on the server, so they follow the person to any browser; the notepad saves as
they type.

## Reporting

**Reports** keeps the workspace overview and adds **dashboards** beside it, as
tabs: shared with the workspace, made by any member, changed by their owner or
a manager. A chart is a question — which tasks (all, incomplete, completed,
overdue only, some projects), grouped by status, priority, assignee, project,
due week or completion week, drawn as a number, bars, columns or a donut — and
the server answers it for each viewer over the tasks they can see, so a shared
dashboard never shows a private project's work to someone outside it.

## Teams

Each team has a page (from its name on Teams): its description and lead, its
**projects** — only those the reader can open, archived last — and its
**members**, with **Edit team** and **Manage** for the lead or an admin. Its
**Messages** tab (`?tab=messages`) holds the team's own conversations:
visible to the workspace, posted to by the team's members or any manager,
with everyone on the team notified of a new one and the people in a thread of
each reply.

## Advanced search

**Search** (in the sidebar, and _Advanced search_ in the top bar's search) finds
tasks across every project the reader can see: words in the title or
description, then **Assignee** (me, unassigned, anyone), **Projects** (a task
linked into a project counts there), **Status** (incomplete by default, as in
Asana), **Due date** (overdue, today, the next 7 days, none — read against the
searcher's own today), **Created by**, **Collaborators**, and a sort. The search
lives in the address bar, so it is a link; results open in the task panel
without leaving it. **Save search** names it and lists it under _Saved
searches_ in the sidebar — each person's own, with "me" always meaning them. A
saved search that has been changed offers **Save changes**; its menu saves it
as a new one, renames or deletes it. Private projects stay private: the search
runs inside the same scope as every task list.

## My Tasks and Inbox

- My Tasks opens on Asana's **sections** — Recently assigned, Do today, Do next
  week, Do later — stored per person, as a list or as a **Board** whose columns
  are the same sections; the filtered list stays as "All tasks".
- Inbox has **Archive** and **Bookmarks** beside All / Unread / Mentions, with
  "Archive all".
- **Settings › Notifications** chooses which kinds also arrive by email, per
  workspace: assignments, @mentions, comments on what you follow, changes to
  it, project updates, due soon. Assignments and mentions are on until changed;
  the inbox keeps everything either way.
- **Auto-sort** (My Tasks' header): tasks due today or overdue move into Do
  today, and, if turned on, tasks due in the next seven days into Do next week.
  The rules are per person and per workspace, Do today is on by default, and a
  task moved by hand today stays where it was put until tomorrow.
- **Profile** (Settings › Your profile): name, pronouns, job title,
  department, about me, time zone, and **out of office** dates with a note.
  The member list shows the title and pronouns. The member list and the task
  assignee picker say "Out of office until Oct 23" while it lasts.
- **Sync to calendar** (My Tasks' header, and a project's menu): a private
  iCalendar link for Google Calendar, Outlook or Apple Calendar. Tasks with due
  dates show as all-day events, or timed ones with a due time. The link can be
  reset, which retires the old one, or stopped, and it follows the owner's
  access as it changes.

## Goals

A tree of goals with status (on/at risk/off track, achieved…), owner, team,
time period and due date. Progress is manual, or rolls up from sub-goals or
from connected projects' completion (counted the way the project card counts
it), or is measured by a **number** — a start, a current value and a target
with a unit ("10 of 40 leases"), counting up or down. Deleting a goal moves
its sub-goals up to its parent.

**Status updates** (Asana's goal check-ins): a goal's sheet takes an update —
the status it is in now, and what changed — and keeps the history, each with
its author, time and the progress at that moment. The newest sets the goal's
status, and the owner is told when someone else posts one. A goal opens from a
link (`/goals?goal=…`), which is where those notifications and Create › Goal go.

## Still open, roughly in order

1. Nothing from the list this page started with; what remains are smaller
   gaps, noted under each section above.

The portfolio **Timeline** has a working toolbar: **Search** by name,
**Filter** by status update, "only projects I lead" and "only projects with
dates", and **Sort** by portfolio order, name, start date or due date.

Portfolios are now on the server: shared with the workspace, filtered by
what each person can open, starred per person, with **Dashboard**, **Progress**,
**Workload** and **Messages** tabs. Workload counts each person's open work in
the portfolio's measure (task count or estimated hours) against a capacity — a
default for everyone, with per-person numbers — and marks who is over it and
by how much; capacities are the owner's or a manager's to set. Portfolio messages are conversations across
its projects: members post and reply, guests read, and a new message tells the
owner and everyone who starred the portfolio.

A portfolio has a **status of its own**, too: its owner or a manager picks one
from **Set status** in the header (on track, at risk, off track, on hold,
complete, dropped) and writes a title, summary and next steps. The newest shows
as a chip beside the name and heads the Progress tab, with earlier ones folded
beneath it; the owner and everyone who starred it are told.

Project status updates are now posted to the server: the header's **Set
status** writes one, the project's members are notified, and the newest is the
status every list and portfolio shows.

**Request status update**, in the same menu, asks the person responsible:
a project's owner (or, with none, whoever posted its last update) or a
portfolio's owner. Anyone who can see it may ask, and only one ask an hour
reaches that person. Someone who may not post an update sees only that item.

A posted status update also goes to the project's **chat apps** (Customize ›
Apps, on by default for new connections), and the composer's "Connected
channel" row lists the channels that will receive it. Workspace webhooks can
subscribe to it as `project.status_updated`.
