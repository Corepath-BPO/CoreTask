# List selection, bulk edit and keyboard shortcuts

Two things Asana's list does that ours did not: select several rows and change
them together, and drive the common actions from the keyboard with Tab chords.
This documents the shape each took and why.

## Selecting rows

Selection lives in the List view (`web/src/features/projects/components/project-list-view.tsx`)
as a set of ids plus an anchor — the last plain click, which a shift range
extends from. The rules are pure functions in `web/src/features/projects/lib/selection.ts`:

- **A click on the row's own padding selects.** A click on a control — the
  title, a cell, the drag grip — is that control's, so `isInteractiveTarget`
  looks for the nearest button, link, field or option and leaves those alone.
- **Shift-click extends** to a range over the rows as drawn (`visibleOrder`):
  collapsed sections are skipped, and subtasks never take part. They belong to
  their parent, as they do for dragging, and a bulk move would quietly promote
  one.
- **Ctrl/Cmd-click toggles** one row in or out.
- **Escape clears**, in the capture phase so it runs ahead of the task panel's
  own Escape whatever order the two mounted in. The panel honours
  `defaultPrevented`, so the first Escape clears the selection and the second
  closes the panel — Asana's order. A field being edited or an open picker keeps
  its own Escape (`escapeBelongsElsewhere`).
- **A new project or a new search clears it.** The set is reset during render
  rather than in an effect, so a stale selection never reaches the screen.

Rows are selectable only when the view is editable. Each title cell also carries
a checkbox that surfaces on hover and focus, because a row click is a gesture a
keyboard cannot make.

## The bulk bar

`BulkActionBar` is Asana's pill at the foot of the window: "N selected", then
Assignee, Due date, Status, Priority, Move to, Fields, Archive and a clear
button. It is portalled to the body — the list is a scrolling pane, and a bar
inside it would scroll away from the rows it acts on — and every control is a
picker that fires once and resets, since five rows have no single assignee to
show.

**Fields** is two steps in one popover: pick the field, then its value in the
same `CustomFieldCell` the grid uses, mounted already open (`autoOpen`), so a
bulk "Severity → High" is the cell edit done once for the whole selection.
Computed and archived fields are left out, and the pill is greyed with a reason
when the selection holds only tickets, since tickets carry no field values.

A ticket in the selection greys out Status and Priority (tickets speak a
different vocabulary) and Archive (tickets do not archive from here); the
control stays, with the reason on hover, rather than vanishing. Archive is
offered only to managers, as the task route requires, and always confirms.

## One bulk request

`POST /workspaces/:ws/projects/:pid/work-items/bulk` takes the ids, and any of
an `update` (status, priority, assignees, dates, custom field values — never
title or description, which are one row's own words), a `sectionId` to move to,
or `archived: true`. See
[docs/api/project-work-items.md](../api/project-work-items.md). A field value
is applied to the tasks only, and the toast says how many tickets were skipped.

The service applies the change to each row **through the same `update`, `move`
and archive paths a single edit takes**, in the order named. That is
deliberate: the activity feed, the rules engine and every open tab see twenty
ordinary changes rather than one unfamiliar event, and a move appends so the
rows keep their relative order. What is checked up front is everything that
could fail part-way — every id must be in the project (404, nothing written),
and a status a ticket cannot hold is refused before the first task is touched.
The request's one correlation id rides on every per-row socket event, so the
originating tab recognises all of them as its own and refreshes once.

## Keyboard shortcuts

Asana's chords — hold Tab, press a letter — with the same letters:

| Keys           | Does                        |
| -------------- | --------------------------- |
| Tab N          | New task                    |
| Tab A          | Assign                      |
| Tab M          | Assign to me                |
| Tab D          | Set due date                |
| Tab Y / Tab T  | Due today / due tomorrow    |
| Tab C          | Comment                     |
| Tab S          | Add subtask                 |
| Tab Backspace  | Archive (confirms)          |
| Ctrl/Cmd Enter | Mark complete or incomplete |
| Esc            | Clear selection, close task |
| ?              | The shortcut sheet          |

Three pieces, all under `web/src/lib/shortcuts/`:

- **`shortcut-definitions.ts`** is the one table behind both the listener and
  the help sheet, so the sheet cannot promise a key the listener does not know.
- **`use-global-shortcuts.ts`** is the single keyboard listener, mounted by the
  app shell. Tab is never `preventDefault`ed — it still moves focus, so keyboard
  navigation keeps working for everyone not chording. The listener only tracks
  whether Tab is _held_ (keydown arms, keyup disarms, with a short timeout for a
  keyup lost to alt-tab), and a letter that lands while it is held, outside a
  field, is a chord. The letter is what gets swallowed. Ctrl/Cmd+K stays
  reserved for search here too.
- **`shortcut-registry.ts`** is a stack of handlers. A screen offers what it can
  do with `useShortcutActions`: the task panel registers at a higher priority
  while it is open, so Tab+A assigns the open task rather than the rows behind
  it; the List registers Tab+N (the first section's add row) and, only while
  rows are selected, the chords that drive the bulk bar. A handler of `null`
  means "mine, but not now" and swallows the key, so a ticket's panel does not
  hand Tab+S down to the list. Handlers live in a ref, so a re-render never
  re-registers and a stale closure never fires.

The help sheet opens from `?` and from the account menu.
