# Rule builder visual parity

What each reference in the brief maps onto, and the measurable criteria a
rebuild has to meet. The reference numbering is the one used in
[the rule builder rebuild](../architecture/asana-parity-rule-builder.md).

"Parity" here means structural equivalence, not pixel copying: the same
information in the same places, with CoreTask's own tokens, type and spacing.

## Reference to component

| Ref   | What it shows                                                   | Component today                                                                | State                 |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------- |
| 01    | Default canvas, header, junction, dashed drop to `+ Add branch` | `automation-builder-page.tsx` header, `automation-canvas.tsx`, `lib/layout.ts` | partial               |
| 02    | `When` inspector                                                | `node-config-rail.tsx` (`configure`) + `node-config-fields.tsx`                | partial               |
| 03    | `Check if` inspector                                            | the same rail and fields                                                       | partial               |
| 04–06 | Action catalogue                                                | `node-config-rail.tsx` (`choose`)                                              | partial               |
| 07    | `+ Add branch` menu                                             | `automation-edge.tsx` — `EdgeAction` rows                                      | partial               |
| 08–11 | Condition catalogue                                             | —                                                                              | not built             |
| 12    | `Otherwise` branch node                                         | a `BRANCH` node's `else` arm                                                   | not built as a branch |
| 13    | Configured `Otherwise if` node                                  | `automation-node.tsx`                                                          | partial               |

### What "partial" means for each

**01.** The header has Back, an inline rule-name input, a status badge, a
settings toggle, Save draft and Publish. It does **not** show the project name,
and there is no autosave indicator — saving is an explicit button, not
debounced. The junction dot on the trigger's outgoing connector and the dashed
drop to an `+ Add branch` pill do not exist; the equivalent control is an
ellipsis on the edge that opens a small menu, with a dashed vertical rule
beneath it.

**02.** One inspector shell exists and takes both jobs — choosing a step and
configuring it — because they are two halves of one act, and moving between a
popover for the first and a drawer for the second makes one task feel like two.
The four distinct trigger configurations reference 02 requires (`Section is
changed` / `is…` / `is not…` / `is one of…`) are not modelled: a trigger has one
optional `sectionId` scope, and `triggerMatches` implements only the equality
form.

**03.** The condition operator and value are separate fields, and the value list
comes from the project via `GET /metadata`. That part matches.

**04–06.** The rail's `choose` mode is searchable and shows the eleven
executable actions grouped by `AUTOMATION_SELECTOR_CATEGORY`. There are no tabs,
no `External actions` tab, no icons per row, and no per-custom-field entries.
See [the action catalogue](../architecture/automation-action-catalog.md).

**07.** The edge menu offers `Add a step` and then either `Otherwise if…` or
`Add branch`, whichever fits that position — offered instead of each other, not
beside each other, because on an otherwise arm they are the same act and two
entries doing one thing is how somebody picks the wrong one. Neither carries the
descriptive subtitle reference 07 shows.

**13.** The ellipsis menu on the card's right and the hover-revealed add control
exist. The drag handle on the left of the junction dot does not, and there is no
branch reordering to attach it to. The bottom connector exists as a hidden
handle; nothing draws a control at it.

## Visual acceptance criteria

These are checkable. A rebuild that changes one of them is changing a decision,
not a detail.

### Node dimensions

| Measure                  | Value               | Where                                              |
| ------------------------ | ------------------- | -------------------------------------------------- |
| Card width               | 380 px              | `w-[380px]` on the card, `GRAPH_LAYOUT.NODE_WIDTH` |
| Card height (layout)     | 96 px               | `GRAPH_LAYOUT.NODE_HEIGHT`                         |
| Column gap               | 90 px               | `GRAPH_LAYOUT.COLUMN_GAP`                          |
| Row gap between branches | 190 px              | `GRAPH_LAYOUT.BRANCH_GAP`                          |
| Canvas origin            | (40, 140)           | `GRAPH_LAYOUT.ORIGIN_X` / `ORIGIN_Y`               |
| Icon tile                | 32 px, `rounded-lg` | `size-8` on the tile                               |
| Card padding             | 12 px / 10 px       | `px-3 py-2.5`                                      |

The geometry lives in `@coretask/contracts` rather than in the component,
because the server derives layout for the graph response and the canvas derives
it again for drawing. Two copies of these numbers means two arrangements of one
rule.

**The height is a layout assumption, not a rule.** Nothing sets a height on the
card; it is padding plus content, and a two-line summary is taller than the
assumed 96. `BRANCH_GAP` is 190 rather than a tighter figure because the gap
is not empty — the add control and the arm label both sit on the connector
between two rows, and at 120 against a 96-tall card they were drawn on top of
the card above. A rebuild that changes the card's content height has to re-check
that gap; nothing will fail if it does not, it will just overlap.

### The three connector positions

Every node carries three React Flow handles:

| Position | Type     | Id       | Purpose                     |
| -------- | -------- | -------- | --------------------------- |
| Left     | `target` | default  | the incoming edge           |
| Right    | `source` | default  | the next step on this row   |
| Bottom   | `source` | `branch` | the drop to the next branch |

All three are `!opacity-0` and `isConnectable={false}`. Hidden rather than
absent: React Flow needs a positioned handle to route an edge, and a visible dot
on every node reads as something to drag — when connections here are made by
adding steps, never by drawing lines.

The bottom handle being a distinct id is what lets the branch drop leave from
the card's bottom edge while the ordinary next-step edge leaves from the right.
One handle for both would put every branch line on the right-hand side, which is
where the row's own continuation already goes.

### Hover-reveal, and why focus matters more

Two controls appear on hover:

| Control       | Position                                            | Reveal condition                              |
| ------------- | --------------------------------------------------- | --------------------------------------------- |
| Ellipsis menu | `right-2`, vertically centred, inside the card      | hover, focus-within, focus-visible, menu open |
| Add-after `+` | `-right-3`, vertically centred, straddling the edge | hover, focus-within, focus-visible            |

```
opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100
```

`group-focus-within` is not optional and is the reason the triple exists. A
permanent button on every card is a second thing to read on every step; one that
appears only on hover cannot be reached without a mouse. Tabbing through the
rule has to surface the same controls a pointer does.

The menu also stays visible while it is open (`data-[state=open]:opacity-100`),
because a menu whose trigger fades out from under the cursor looks like a
rendering fault.

Acceptance: with a keyboard only, tab to any node and both controls must be
visible and reachable. Any rebuild that reveals on `:hover` alone fails.

### Inspector width

360 px, fixed, `shrink-0`, with a left border, as an `<aside>` whose accessible
name changes between "Rule settings" and "Step settings" depending on what it is
showing.

Beside the canvas rather than over it: a step only makes sense in the shape it
sits in, and a sheet covering the canvas takes away the thing that explains what
is being edited. It also stays put — an overlay opening and closing on every
selection makes the whole page flinch.

360 against a 380-wide node is deliberate: the panel is narrower than the thing
it configures, so a rule of two or three steps still reads on a 1280-wide window
with the panel open.

Collapsing hides it entirely rather than narrowing it. On a small window the
canvas needs the room more than the form does.

### Dark mode primary

```css
--primary: oklch(0.763 0.164 134); /* both themes */
--primary-foreground: oklch(0.21 0.006 285.9); /* light */
--primary-foreground: oklch(0.171 0.006 285.9); /* dark */
```

**The brand green does not change between themes.** At L=0.76 it already reads
bright against a dark background; lightening it further would only wash it out.
Only the foreground moves, and it moves between two dark values — the text on a
primary button is dark in both themes, because white on this green measures
2.02:1 against the 4.5:1 that AA needs for body text, while dark measures 10.4:1.

`--ring` is the same green, so a focus ring is the brand colour at 40 % over a
3 px outline (`focus-visible:ring-[3px] focus-visible:ring-ring/40`).

On the canvas the accent appears as a **tile behind the icon at 15 % opacity**,
never as a card fill:

| Category    | Accent              |
| ----------- | ------------------- |
| `TRIGGER`   | `primary` at 15 %   |
| `CONDITION` | violet 500 at 15 %  |
| `ACTION`    | emerald 500 at 15 % |
| `BRANCH`    | cyan 500 at 15 %    |
| `DELAY`     | amber 500 at 15 %   |

A node saturated end to end makes its own text the least readable thing on the
canvas, and six of them side by side stop being distinguishable at all. A small
tile carries the same signal at a size where the colour stays decoration.

Acceptance in both themes: a selected node's border is `primary`; an invalid
node's border is `destructive/60`; a placeholder is dashed with no shadow and no
fill.

### Values are set apart from the sentence

Card text is a list of segments, not a string. Values render as chips
(`bg-muted`, `rounded`, 13 px, truncated at 210 px); the words around them do
not. "Section is `Incoming Request`" is scannable; the same sentence in one
weight has to be read.

The split is decided in `summariseParts`, not in the component, so the visible
label and the accessible name cannot disagree — the `aria-label` is the same
segments joined. A reference that no longer resolves says so in words ("a
section that was removed"), never as a raw id: an id on a card looks like data
rather than like a mistake, and the thing that needs to happen is somebody
noticing the section was deleted.

## Not yet built

- The `+ Add branch` pill and its two-entry described menu (reference 07).
- The condition catalogue (references 08–11), including the AI entry shown
  disabled.
- The `Otherwise` branch node as a first-class node (reference 12).
- The drag handle and branch reordering (reference 13).
- Tabs in the catalogue, and the `External actions` tab.
- Per-custom-field entries in either catalogue.
- The project name in the header, and the autosave indicator.
- Any rendering of the structured branch model — the canvas still projects the
  node tree. See [the structured rule model](../architecture/automation-rule-tree.md).

## Related

- [The rule builder rebuild](../architecture/asana-parity-rule-builder.md)
- [The action catalogue](../architecture/automation-action-catalog.md)
- [The colour system](../architecture/color-system.md)
