# CoreTask marketing site

The public page for CoreTask: a scroll-driven story from scattered requests to
finished work. Next.js, exported as static files — see
[ADR 0017](../docs/decisions/0017-marketing-site-is-a-static-next-export.md).

```bash
pnpm --filter @coretask/site dev        # http://localhost:3200
pnpm --filter @coretask/site build      # static export to site/out/
pnpm --filter @coretask/site preview    # serve out/ at http://localhost:3201
pnpm --filter @coretask/site studio     # edit the product clips in Remotion Studio
pnpm --filter @coretask/site assets     # re-render posters and the share card
```

## Before it goes public

| What                   | Where                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| The domain             | `NEXT_PUBLIC_SITE_URL` at build time (canonical URLs, sitemap, share cards)     |
| The early-access inbox | `NEXT_PUBLIC_CONTACT_EMAIL` at build time (every "Request early access" button) |
| A Remotion license     | Required for organisations of more than three people — remotion.dev/license     |

Both variables default to `coretask.example` placeholders, which are not real
addresses.

## Docker image

`site/Dockerfile` builds the export and serves it with nginx on port 8080, the
way `coretask-web` ships ([`infrastructure/nginx/site.conf`](../infrastructure/nginx/site.conf)).
Build from the repository root; both variables are baked in, so changing either
means rebuilding the image.

```bash
docker build -f site/Dockerfile -t coretask/site \
  --build-arg NEXT_PUBLIC_SITE_URL=https://coretask.example \
  --build-arg NEXT_PUBLIC_CONTACT_EMAIL=hello@coretask.example .
docker run --rm -p 8081:8080 coretask/site    # http://localhost:8081
```

In the production stack it is the `coretask-site` service, published on
`SITE_HTTP_PORT` (8081 by default):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build coretask-site
```

nginx caches `/_next/static/` and `/media/` for a year and makes everything else
revalidate. The posters in `public/media/` are not content-hashed, so a poster
that changes needs a new file name, or returning visitors keep the old one.

## Where things are

| Path                  | What                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `src/content/site.ts` | Every word on the page, the SEO title and description, and the FAQ     |
| `src/sections/`       | One file per chapter of the story, in page order in `src/app/page.tsx` |
| `src/three/`          | The 3D mark in the hero (react-three-fiber), loaded after the headline |
| `src/remotion/`       | The product clips, played in the page and rendered to `public/media/`  |
| `public/og.png`       | The share card, rendered from `src/remotion/og-image.tsx`              |

## Changing a clip

Clips are React compositions driven by the frame number, so the page can scrub
them with the scroll position. Edit one under `src/remotion/`, preview it with
`pnpm studio`, then run `pnpm assets` and commit the new posters — each poster is
the clip's last frame, shown before the player loads and to visitors who prefer
reduced motion.

`pnpm assets` downloads a headless Chrome on first use. To use one already on
the machine, set `REMOTION_BROWSER_EXECUTABLE` to its path (Playwright's
`chrome-headless-shell` works).

## Copy rules

The page claims only what CoreTask does today — the README's Project status is
the source. There are no customers, figures or testimonials yet, so it invents
none; add them only when they are real.
