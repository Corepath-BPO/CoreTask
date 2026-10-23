# 0017. The marketing site is a static Next.js export

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

CoreTask needs a public page to market it: crawlable, shareable, fast on a
phone, and carrying the story the product tells — scattered requests becoming
finished work. [0001](0001-react-with-vite.md) kept the dashboard a client-only
SPA and set this surface aside for a separate `site/` application, "Next.js
the likely choice". The page is meant to feel like a product film: scroll-driven
motion, a 3D mark, and clips of the product working.

## Decision

`site/` is a Next.js app built with `output: 'export'`: plain HTML, CSS and JS
that nginx or a CDN serves with no Node.js at run time, the same way
`coretask-web` ships ([0006](0006-independent-deployability.md)).

- Every word is server-rendered into the HTML. Motion is layered on top with
  framer-motion; nothing a crawler needs lives inside a canvas or a video.
- The 3D mark (react-three-fiber) and the product clips (Remotion's
  `@remotion/player`, scrubbed by the scroll position) load lazily, behind the
  headline and behind each clip's rendered poster, so neither weighs on the
  first paint.
- The clips are React compositions, not video files. The same components
  render the posters and the share card to images (`pnpm assets`), which are
  committed so the build never needs a browser.
- Visitors who ask for reduced motion get a still page: no pinning, no scrubbing,
  the posters in place of the clips.

## Alternatives considered

**A route in the dashboard.** It would ship the whole app's bundle to every
visitor and still render nothing until the JavaScript ran — the reasons 0001
gives for keeping the dashboard client-only are the reasons a marketing page
cannot be one.

**Next.js with a server.** Nothing on the page is per-visitor, so a server would
be a runtime to deploy and secure for no benefit. If a page ever needs one, the
export can be dropped for that page alone.

**Pre-rendered MP4s instead of live compositions.** Lighter JavaScript, but a
video cannot follow the scroll frame by frame without stutter, blurs at
high-density screens, and every copy change means re-encoding.

## Consequences

**Easier**

- Hosting is a folder of files, which the site's own `preview` script serves
  locally exactly as nginx will.
- Copy lives in one file (`site/src/content/site.ts`), and the FAQ's structured
  data is built from the same entries the page shows.
- A clip is edited as code and previewed in Remotion Studio.

**Harder / accepted**

- Remotion is free only for organisations of up to three people; this site needs
  a Remotion Company License before it goes public.
- Server-side image optimisation is unavailable in an export, so images are
  committed at the sizes they are served.
- Posters are generated files: after changing a clip, `pnpm assets` must be run
  and its output committed, or the poster and the clip will disagree.
