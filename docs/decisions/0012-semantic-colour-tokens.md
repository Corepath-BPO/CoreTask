# 0012. Semantic colour tokens, not CSS classes

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Statuses, priorities, select options and automation nodes all needed a
user-choosable colour, stored per row. The obvious implementation is to store
what the renderer needs:

```
colorClass: "bg-blue-500 text-blue-50"
```

This does not work with Tailwind, and fails in the worst way. The JIT compiler
scans source files for class names; a class that exists only in a database row is
never generated. `bg-${token}-500` produces **no styles at all** — silently, at
runtime, only for values nobody hard-coded somewhere. It looks fine in
development where the seed values happen to appear in source.

Storing the class also ties stored data to a CSS framework: changing framework
would become a data migration.

## Decision

**Store a token — `blue` — and resolve it in exactly one place on the client.**

Nineteen tokens in `@coretask/contracts`. `web/src/features/colors/lib/
color-tokens.ts` maps each to three `oklch` values (`solid`, `surface`,
`onSurface`) applied inline, with **separate tables for light and dark**.

Dark is not the light table dimmed. On a dark surface a tint needs more strength
to register, and its text goes _lighter_ than the accent where on light it goes
darker. A test asserts that direction for all nineteen tokens in both modes.

## Consequences

Good:

- a colour chosen at runtime renders correctly, which the class-name approach
  cannot achieve at all
- light and dark can differ properly without every consumer knowing
- an unrecognised token degrades to grey rather than blanking the component, so a
  row from a newer version of the app still renders
- the palette is auditable in one file

Costs:

- inline styles rather than classes, so these colours sit outside Tailwind's
  tooling — no `@apply`, no variant modifiers, no purge analysis
- two badge systems coexist: `Badge` for fixed semantic states chosen at build
  time, `SemanticBadge` for user-chosen colours. Someone will reach for the wrong
  one
- nineteen tokens × two modes × three values is 114 hand-tuned figures. The test
  catches direction errors, not aesthetic ones
- `customColor` is stored and resolved but has no UI yet, so part of the design
  is unexercised

Rejected: CSS custom properties per token defined in `globals.css`. It would keep
styling in CSS, but light/dark would need doubled definitions and the values
would be no more auditable than a TypeScript table — while making the fallback
for an unknown token much harder to express.
