# The rule builder's layout

The team moving to CoreTask builds rules in Asana, so the builder follows the
structure and flow of Asana's rule editor (studied in Asana on 28 Oct 2026, view
only). CoreTask's own look, icons and wording are kept; nothing is copied from
Asana but the arrangement.

The rule itself does not change. The canvas draws the same graph of trigger,
conditions, rows and actions that the runner executes; only how it is grouped
and laid out on screen is new.

## What Asana's editor is

- **A full-screen page over the project.** The top bar has the rule's name and
  an Active switch on the left, **Build | Activity** tabs in the middle, and
  Cancel / Save with a settings gear and a ⋯ menu on the right.
- **A canvas read top to bottom,** on a dotted grid:
  - **Trigger card.** Headed with what the rule acts on ("Tasks in [project]"), a
    Trigger badge, and the trigger as step 1 ("1. Status is changed").
  - **Path cards.** Under the trigger, side by side: **Check if**, then **Else
    if** for each further question, then **Otherwise**. Each card shows its
    conditions as short sentences with the values as chips, and has a ⋯ menu
    and a drag handle.
  - **Task card.** Under each path, the path's actions grouped into one card
    headed "Task", each action numbered across the whole rule ("2. Move task
    to a certain section [To Do]", "3. Set Started [the date this automation
    is triggered]").
  - **Add.** A **+** under the last card of a column adds a step. It opens a
    small menu: Actions, and Flow controls (Paths). **Add branch** sits on the
    connector that fans out to the paths.
- **A toolbar on the left:** fit to view, zoom in, zoom out, minimap, and
  expanded or collapsed view (collapsed shows each card as one line).
- **A side panel on the right** when a step is selected:
  - **Trigger:** "Choose trigger" plus the trigger's own fields, and at the bottom
    what the step outputs ("Output: 1. Task").
  - **Path:** Path name, Scope (Task), and a Conditions list. Each condition folds
    open, has a delete button, and has "Choose an option" plus a value picker,
    with **+ Add condition** below.
  - **Action:** "Choose action" plus the action's own fields.
- **The rule list** is a drawer from Customize › Automations. It has an "In this
  project" heading with **+ Add**, and one row per rule: an icon, the name, and
  "Active · Last run yesterday", with a ⋯ menu on hover.
- **Adding a rule** opens a full-screen page. It has a "What do you want to
  automate?" prompt, **Start from scratch**, and a Featured gallery of template
  cards (icon, title, one line).

## How it maps onto CoreTask's graph

| On screen                 | In the graph                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Trigger card, step 1      | the `TRIGGER` node                                                                                                    |
| Path cards, left to right | the trigger's `CONDITION` children (`branchRows`), in their order; the first reads **Check if**, the rest **Else if** |
| **Otherwise** path        | the fallback row (`fallbackRow`)                                                                                      |
| A path's conditions       | the row's own condition, then any `CONDITION` steps that follow it before the first action                            |
| Task card                 | a run of consecutive `ACTION` steps (and the placeholder for one being chosen)                                        |
| A further Check if card   | a `CONDITION` step that comes after an action (rare; drawn as its own card in the column)                             |
| Step numbers              | the trigger and every action, counted down each column, columns left to right                                         |

A rule with no rows draws the trigger with its Task card straight beneath it, as
Asana does.

Every card is one React Flow node, and each line inside it selects its own graph
node, so the side panel, validation and saving work on steps exactly as before.
The canvas keeps the same contract with the page: it gets the graph and reports
select, open, insert step, add else-if, add otherwise, duplicate, delete, change
trigger and move row.

## Layout

- **Columns.** The trigger sits at the top left. Its paths go side by side in a
  row beneath it, one column each, left to right in row order. Each column
  stacks its cards top to bottom.
- **Sizes.** Card heights come from what is in them (a header, plus one line per
  step), worked out before drawing, so the layout is deterministic and needs no
  second pass.
- **Connectors.** Right-angled with rounded corners: down from the trigger, across
  to each path, and down each column.

## Interactions

- **Click a line** to select that step and open it in the side panel. Click the
  canvas to clear the selection.
- **+ under a column** opens the add menu:
  - **Action** inserts after the column's last step (the actions list opens);
  - **Path** adds an Else if;
  - **Otherwise** adds the fallback, offered while there is none.
- **⋯ on a path card:** move left or right among the paths (the fallback stays
  last), duplicate, delete the path with its actions.
- **⋯ on an action line:** duplicate, delete. **⋯ on the trigger:** change
  trigger.
- **Toolbar:** fit, zoom in, zoom out, minimap on or off, expanded or collapsed
  cards.

## Header

- **Left:** the project, the rule's name, and an **Active** switch. A rule is
  still a draft that is published: on publishes it, off pauses it. The switch
  stays off until the rule has a name, a trigger and no blocking problem;
  turning a running rule off never waits on that. A running rule whose draft
  holds more than its live version says "Unpublished changes".
- **Middle:** **Build | Activity.** Activity swaps the canvas for the rule's
  runs, newest first; it is off on a rule never saved.
- **Right:** the problems count, **Cancel** (leave the builder), **Save**, the
  settings gear, and a ⋯ menu with version history, the library and delete.
  Save keeps the draft; on a running rule it also puts the edits live, which is
  what Save means in Asana.

## Rule list

- **Where:** Customize › **Automations**, Asana's name for the row. The builder
  still calls each one a rule.
- **Heading:** **In this project**, "Triggered by activity in this project", and
  **+ Add**, which opens the Add automation page.
- **Rows:** borderless, one per rule:
  - an icon for what sets the rule off;
  - its name;
  - "Active · Last run 3 hours ago". A failed last run says so, in red.
- **Click a row** to open the rule in the builder.
- **⋯ on hover:** the same menu the Automations tab has. It holds edit, run
  history, publish / pause / resume, duplicate, save to library, and delete or
  archive. It shows only to managers, and always on a screen without a pointer.
- **Not taken from Asana:** the drag handle that replaces the icon on hover.
  CoreTask's rules run in no particular order, so there is nothing to reorder.

## Adding a rule

- **Where:** `/projects/:id/automations/add`, over the whole screen like the
  builder. **+ Add** in the rule list and **New rule** on the Automations tab
  open it. **×** goes back to wherever it was opened from.
- **The question:** a bolt, "What do you want to automate?", and a box to answer
  in. The box does two things:
  - **While you type,** the words rank the gallery below, best match first. So
    "assign tasks when they move to a section" brings "Assign whoever owns a
    section" to the top. Cards that share no word step aside.
  - **Send (↑ or Enter)** writes the rule with AI, as Asana's box does. The
    builder opens on the drafted rule, unsaved, at `/automations/new`. "When a
    task moves to Week 1, assign it to Sam and set the due date to Friday"
    opens as "When a task is moved to a section: Week 1", then "Assign Sam",
    then "Set the due date: Friday next week".
- **Drafting, in the API:** `POST …/automations/draft` with `{ prompt }`
  (`AutomationDraftService`). The model is offered the builder's vocabulary as
  tools: one for the trigger, one for a check, and one per action. The
  project's sections, people, statuses, priorities, fields, teams and other
  projects (from `AutomationMetadataService.forProject`) come with it as ids,
  so it can name the real Week 1 and nothing that is not there. Each call is
  read back before it becomes a step. An id that was not offered, or a value
  the step cannot hold, is left out and named in `notes`.
  - **What comes back:** the nodes in the shape the builder saves. That is the
    trigger, one **Check if** (a group of ALL when the sentence names several
    conditions), then the actions in order. With them come the graph
    validator's answer and the notes. Nothing is written.
  - **Not drafted:** ticket rules, AI steps, branches and Wait steps. A sentence
    that is not a rule at all gets a 422 with the model's reason, shown under
    the box.
  - **Dates:** a weekday such as "Friday" is that day of the following week,
    because that is the relative date a rule can store.
  - **Limits:** managers only, and 10 drafts a minute.
- **The hand-off:** the draft travels in the history entry's state
  (`automationDraft`), not the address, so a reload reopens the same draft.
  `makeDraftNodes` shapes the canvas as `makeStarterNodes` shapes a starter's.
  The builder counts a drafted rule as unsaved from the start: **Save** is
  offered straight away, and closing asks first. Anything left out shows as a
  toast while the builder opens.
- **Only with a model:** the send button shows only where
  `capabilities.ai` on the metadata is true (`ANTHROPIC_API_KEY` set). Without
  one the box only ranks the gallery, and Enter does nothing.
- **OR, Start from scratch:** a blank rule in the builder.
- **Featured:** the starters, as cards in a grid of four. Each card shows what
  sets it off ⚡ what it does, its name, and a line. A starter opens in the
  builder unsaved, with its blanks left to fill.
- **Saved in this workspace:** the rule library's templates, as the same cards
  with "From [project]". Choosing one makes a draft in this project and opens
  it, as the library does.
- **Nothing is created** until a saved rule is chosen or the builder saves, and
  sending a sentence is no exception.
- Only a project's managers see the page. Anyone else is told so.
