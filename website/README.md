# CoreTask marketing site

The public page for CoreTask: a scroll-driven story from scattered requests to
finished work. Next.js, exported as static files — see
[ADR 0017](../docs/decisions/0017-marketing-site-is-a-static-next-export.md).

```bash
pnpm --filter @coretask/website dev        # http://localhost:3200
pnpm --filter @coretask/website build      # static export to website/out/
pnpm --filter @coretask/website preview    # serve out/ at http://localhost:3201
pnpm --filter @coretask/website studio     # edit the product clips in Remotion Studio
pnpm --filter @coretask/website assets     # re-render posters and the share card
```

## Domains and settings

The website is served at **coretask.org**; its Sign in link and the app live at
**app.coretask.org**. All three settings are read at build time and default to
the production values:

| Variable                    | Default                    | Used for                                          |
| --------------------------- | -------------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`      | `https://coretask.org`     | Canonical URLs, sitemap, robots, share cards      |
| `NEXT_PUBLIC_APP_URL`       | `https://app.coretask.org` | The Sign in link in the header and footer         |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@coretask.org`       | Every "Request early access" button (a `mailto:`) |

The footer lists the other two addresses as well: `support@coretask.org` for
help and `official@coretask.org` for official enquiries. Both also appear in the
structured data, beside `hello@` for sales.

The product clips use Remotion under its free license, as the team's other
projects do.

## Docker image

`website/Dockerfile` builds the export and serves it with nginx on port 8080, the
way `coretask-webapp` ships ([`infrastructure/nginx/website.conf`](../infrastructure/nginx/website.conf)).
Build from the repository root; the settings above are baked in, so changing one
means rebuilding the image.

```bash
docker build -f website/Dockerfile -t coretask/website .
docker run --rm -p 8081:8080 coretask/website    # http://localhost:8081
```

In the production stack it is the `coretask-website` service, published on
`WEBSITE_HTTP_PORT` (8081 by default):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build coretask-website
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
