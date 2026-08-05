# List view columns

Which columns a view shows, where they sit, how wide they are, and why none of
that lives in `localStorage`.

## Columns are stored, not remembered

A view's columns live in `ProjectView.settings`, in PostgreSQL:

```json
{ "columns": [
    { "field": "title",       "width": 300, "isPinned": true },
    { "field": "assigneeId",  "width": 170 },
    { "field": "custom:019f…","width": 150 }
] }
```

`localStorage` was never an option. A shared view whose columns are per-browser
is not shared — two people looking at "the List view" would be looking at
different things, and neither could tell the other what to click. Arranging
columns on a laptop and finding them unarranged on a desktop is the same bug from
one person's point of view.

Custom fields are referenced as `custom:<uuid>`, which keeps one namespace for
system and custom columns without either being able to collide with the other.

The settings document is Zod-validated on write rather than normalized into
tables. Columns are read as a whole and written as a whole; splitting them into
rows would buy ordering and constraints that a JSON array already gives, at the
cost of a join on every read.

## What a view can actually show

`visibleColumns(columns, metadata)` filters at render, and drops two things:

- **`SECTION`.** Every row already sits inside a card headed by its section, so
  the column repeated that down the page for a column's width.
- **Any `custom:` field that no longer exists.** A view outlives the fields it
  names. A column of dashes under a header reading "Deleted field" is worse than
  no column.

Custom columns survive while `metadata` is `undefined`: nothing is known to exist
during loading, and filtering then would drop every custom column and add it back
a moment later.

Filtered at render, never written back. A view is presentation, and rewriting the
stored settings would decide on somebody's behalf that a field is gone for good —
when an archived field can be restored.

## The Task column is fixed

Not "pinned by default" — fixed. `isFixedColumn(field)` is true for `TITLE`, and
that column does not move and does not unpin:

- `moveColumn` returns unchanged when asked to move it, and clamps every other
  drop so nothing lands in front of it;
- `setPinned` returns unchanged when asked to unpin it;
- `isPinnedColumn` reports it pinned even if a stored setting says otherwise;
- the header renders it without drag listeners and without a pin control, so the
  UI never offers a rearrangement that the logic will refuse.

It is what every other cell in the row is *about*. Scrolled away, nothing names
the task; moved out of first place, it reads as one more attribute of a task the
grid no longer identifies.

## Pinning the rest

A pinned column is `position: sticky` with a computed `left`, which is only
meaningful while the pinned block is contiguous and leads the row. `setPinned`
is what keeps it that way: pinning hoists the column to the end of the frozen
block rather than freezing it where it stands, because a pinned column with
unpinned ones to its left would either overlap them as they scroll underneath or
leave a gap.

Unpinning drops the column just past the block, so it stays near where it was
rather than jumping to the far end of a wide grid.

A drag that lands inside the frozen block pins; one that lands past it unpins.
The state follows from the destination, so the drop always does something —
refusing it reads as the drag having failed.

## Sizing

Every section renders its own `<table>`, so the cards can be styled and dragged
independently. They line up because each declares the same `<colgroup>` and
`table-fixed`.

Two details that took measuring to get right:

- A trailing flexible spacer column is required. With `table-fixed`, a colgroup
  summing to less than the table's width has the surplus redistributed across the
  declared columns — the header measured 420px where the body measured 454px.
- `DndContext` renders a live region for screen readers, so it must wrap the
  table and never sit inside a `<tr>`, where the extra element became phantom
  header cells.

Widths are clamped to 60–800px in the browser, matching what the API enforces.
Duplicated deliberately: a drag that could travel past the limit would be
rejected on save, and a column that snaps back after you let go is worse than one
that stops under the cursor.

Column drag uses `pointerWithin` rather than `closestCenter`, because these
columns differ in width by about 5× and a centre-distance test makes the wide
ones swallow drops aimed at the narrow ones.

## Cells

Each cell is editable in place, with an editor chosen from the field's type and
settings — a `LONG` text field gets a textarea, a `DATE_TIME` date field gets a
time component, a `MULTIPLE` people field accepts more than one person.

Every clickable cell carries `cursor-pointer`, and every cell carries a right-hand
rule so a value reads as belonging to the header above it rather than to whichever
column the eye lands on.
