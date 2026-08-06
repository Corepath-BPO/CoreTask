# Semantic colour system

Statuses, priorities, select options and automation nodes all store a colour.
This is what a stored colour means and how it becomes pixels.

## A token is a name, not a class

```prisma
colorToken  String  @default("gray")   // "blue"
customColor String?                    // "#3B82F6", when a workspace overrides
```

`blue`, never `bg-blue-500`. Two reasons, and either alone decides it:

1. **Tailwind cannot see a class that only exists in a database row.** The JIT
   compiler scans source files, so `bg-${token}-500` produces no styles at all —
   silently, at runtime, only for values nobody hard-coded.
2. Class strings in the database tie stored data to a CSS framework. Changing
   framework would mean a data migration.

Nineteen tokens (`COLOR_TOKENS` in `@coretask/contracts`), matching the palette
the spec names.

## One resolution point

`web/src/features/colors/lib/color-tokens.ts` is the only place a token becomes
a colour. Each resolves to three values, because a colour is used three ways:

|             | Used for                      |
| ----------- | ----------------------------- |
| `solid`     | dots, bars, node accents      |
| `surface`   | the tint behind a badge       |
| `onSurface` | text and borders on that tint |

Built on `oklch` for the same reason the theme is: lightness is perceptually even
across hues, so one lightness figure gives every token comparable weight rather
than yellow shouting and indigo vanishing.

## Dark mode is not the light table dimmed

Two separate tables. On a dark surface a tint needs more strength to register at
all, and its text has to go **lighter** than the accent — where on a light
surface it goes darker. Reusing one table with opacity tweaks produces the muddy,
low-contrast badges this is meant to avoid.

A test asserts the direction for all nineteen tokens in both modes:

```ts
expect(lightness(light.onSurface)).toBeLessThan(lightness(light.solid));
expect(lightness(dark.onSurface)).toBeGreaterThan(lightness(dark.solid));
```

Getting it backwards is invisible in a snapshot and obvious to anyone using the
product.

## Degrading rather than throwing

An unrecognised token resolves to the default. A row written by an older or newer
version of the app renders grey; it does not blank the screen.

`customColor` wins over `colorToken` when set — it is the more specific choice —
and its tint is derived with `color-mix` rather than guessed.

## Colour is never the only signal

Every component pairs colour with text or an icon:

- `ColorDot` is always `aria-hidden`; a dot alone says nothing to a screen reader
- `SemanticBadge` renders a tint plus a readable label, not a saturated fill
- `ColorTokenPicker` labels each swatch with its token name, so violet and purple
  are distinguishable without seeing them
- the section lightning icon puts its state in the accessible name —
  _"Automations for In Progress — 2 active rules"_ — not only in amber vs blue

A tint rather than a fill, because thirty rows of saturated colour reads as
thirty alarms.

## Two badge systems, deliberately

`components/ui/badge.tsx` encodes a fixed semantic set chosen at build time
(`success`, `warning`, `destructive`). `SemanticBadge` renders a colour chosen by
a **user at runtime**.

They coexist rather than one replacing the other: archived state is a fixed
concept, a status colour is not.

## Defaults

Seeded from `@coretask/contracts`:

| Status      | Token   |     | Priority | Token  |
| ----------- | ------- | --- | -------- | ------ |
| Backlog     | slate   |     | None     | gray   |
| To Do       | gray    |     | Low      | blue   |
| In Progress | blue    |     | Medium   | amber  |
| In Review   | violet  |     | High     | orange |
| Waiting     | amber   |     | Critical | red    |
| Blocked     | red     |     |          |        |
| Done        | emerald |     |          |        |
| Cancelled   | gray    |     |          |        |

Automation nodes: trigger blue, condition violet, action emerald, branch cyan,
delay amber. Run states: active/completed emerald, draft gray, paused amber,
running blue, failed red, partially failed orange, disabled slate.

## Known limitations

- **`customColor` has no UI.** The column and resolution exist; nothing lets a
  workspace set one yet.
- **The legacy badges still map enums to variants.** `status-badge.tsx` predates
  this and will move to tokens with the enum cut-over, not before.
