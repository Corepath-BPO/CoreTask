# Variables in rule text

Actions that write text — a comment body, a notification title, a task title —
need to say things about the task they are acting on. "The %task% you own has
moved to %section%" is one sentence with two holes in it.

This document describes how those holes are represented, and why they hold
references rather than text.

## Status: none of this is built

There is no variable support in CoreTask. Searching `api/src`, `web/src` and
`packages` for a template, segment or variable representation in the automation
modules returns nothing. `ADD_COMMENT` takes a literal `body` string and posts
it verbatim; `SEND_IN_APP_NOTIFICATION` takes a literal `title` and `body`.

This is a design document for something not yet implemented. Nothing below
describes observable behaviour. It exists because the representation is the part
that is expensive to change afterwards, and because an action that can only
write constants is the reason several catalogue entries are absent — see
[the action catalogue](./automation-action-catalog.md).

## The representation: an ordered list of segments

A template is not a string. It is a list, each element either literal text or a
reference:

```json
[
  { "kind": "TEXT", "text": "The task " },
  { "kind": "VARIABLE", "source": "TASK", "field": "title" },
  { "kind": "TEXT", "text": " moved to " },
  { "kind": "VARIABLE", "source": "TASK", "field": "sectionId" }
]
```

Rendering walks the list and resolves each `VARIABLE` against the task the
execution is about. Storage keeps the reference; only the rendered output holds
a name.

## Why references and not rendered values

The alternative is to resolve at authoring time and store the result — "The task
Fix the login redirect moved to In Review". It is simpler in every respect
except correctness.

**A rendered value is a photograph.** The rule is written once and runs for
years, on tasks that did not exist when it was written. A value resolved at
authoring time describes the task the author happened to be looking at, and
every subsequent run repeats it. This is not a subtle failure — it is the
difference between an action that works and one that comments the same sentence
on every task in the project.

**A name is not an identity.** Sections, statuses, custom fields and people all
get renamed. A stored name goes stale silently: the rule keeps posting "moved to
Incoming Request" after the section was renamed to "Triage", and nothing
anywhere is wrong enough to report. A stored id resolves to whatever the thing
is called now.

**A reference can be validated; a string cannot.** Publishing already refuses a
rule naming a section that no longer exists, because the id is in the
configuration where the validator can find it. A section name embedded in prose
is invisible to that check — deleting the section leaves a rule that publishes
cleanly and describes something that is gone.

**Deletion has to be visible.** The builder already renders unresolvable
references as words rather than ids:

```ts
return list?.find((entry) => entry.id === id)?.name ?? "something that no longer exists";
```

That behaviour is only possible because the id is what is stored. `summariseParts`
in `web/src/features/automations/builder/lib/node-summary.ts` resolves ids
against the project's metadata at render time and returns `SummarySegment[]` —
text and chips — for the card to draw. It is the same pattern as the one
proposed here, applied to a step's summary rather than to a body of text, and it
already works: a rule pointing at a deleted section says "a section that was
removed", not a UUID.

## Why segments and not `{{task.title}}` inside a string

Interpolation markers in a plain string are the obvious cheap answer, and they
fail in four specific ways.

**Escaping.** The moment `{{` is syntax, somebody wants to write it literally.
Then there is an escape, then an escape for the escape, and the rule body has a
grammar nobody documented.

**Parsing is a runtime dependency.** Every consumer — the runner, the validator,
the builder's preview, the execution log — has to parse the same string with the
same rules. Segments are already parsed; the database enforces the structure.

**Validation means re-parsing.** Checking that a template's references still
resolve requires extracting them, which requires the parser, which means the
publish check depends on string handling rather than on reading a column.

**Editors cannot render a chip from a substring reliably.** The reference set
shows variables as atomic pills — one backspace deletes the whole reference, and
the caret never lands in the middle of one. A contenteditable over a string with
markers has to reconstruct that atomicity by inference, and the inference breaks
on paste, on undo and on selection across a boundary. With segments the pill
_is_ an element and atomicity is free.

The cost of segments is that the column is a JSON array rather than text, so it
cannot be searched with `LIKE`. That is worth paying; nothing searches automation
bodies.

## What a variable can refer to

Only what the runner has in hand when the action executes. `AutomationEvent`
carries the workspace, project, trigger, entity, actor and the `before`/`after`
maps; the runner loads the task itself. A variable naming anything outside that
set would need a query the runner does not make, and the honest shape of the
first cut is:

| Source  | Fields                                                        |
| ------- | ------------------------------------------------------------- |
| `TASK`  | title, status, priority, section, assignee, due date, creator |
| `ACTOR` | the person whose change fired the trigger                     |
| `RULE`  | the rule's own name, for attributing an automated comment     |
| `FIELD` | a custom field's value on this task, by field id              |

`ACTOR` needs a fallback rendering: `AutomationEvent.actorId` is explicitly null
when a rule caused the event, so "who did this" has no answer in a cascade. A
variable that renders as an empty string in that case would produce sentences
with holes in them; it needs a defined substitute, decided once, rather than per
call site.

## Not yet implemented

Everything on this page. Specifically:

- The segment representation, in the contracts package and in the database.
- Any storage for it. `AutomationAction.configuration` is JSON and could hold it
  without a migration, which is a reason to settle the shape before something
  else is written there.
- Resolution at execution time in `AutomationRunnerService`.
- Reference validation at publish time, alongside the existing section, member,
  status and field checks in `AutomationGraphValidatorService`.
- The variable picker, and the atomic-pill editor behaviour described above.
- The absent title and description actions, which are waiting on this.

## Related

- [The action catalogue](./automation-action-catalog.md)
- [The automation engine](./automation-engine.md)
- [The builder parity criteria](../ui/automation-builder-parity.md)
