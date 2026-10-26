# 0018. Three origins on coretask.org

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

CoreTask now has a domain, `coretask.org`, and two browser-facing apps: the
marketing site added in [0017](0017-marketing-site-is-a-static-next-export.md)
and the dashboard from [0001](0001-react-with-vite.md). Their folders, `site/`
and `web/`, said little about which was which — "site" and "web" both describe
either one — and nothing yet said where each would be served.

## Decision

Each public piece gets an origin of its own, and its folder is named for it:

| Origin             | Folder     | Image              |
| ------------------ | ---------- | ------------------ |
| `coretask.org`     | `website/` | `coretask/website` |
| `app.coretask.org` | `webapp/`  | `coretask/webapp`  |
| `api.coretask.org` | `api/`     | `coretask/api`     |

`web/` became `webapp/` and `site/` became `website/`, with the packages
(`@coretask/webapp`, `@coretask/website`) and compose services
(`coretask-webapp`, `coretask-website`) renamed to match. Environment variable
names (`WEB_URL`, `WEB_PORT`, `WEB_HTTP_PORT`) are unchanged, so existing `.env`
files keep working.

The webapp calls the API cross-origin, as it already does in development
(`localhost:5173` → `localhost:3000`): `VITE_API_URL` and `VITE_WS_URL` point at
`api.coretask.org`, `WEB_URL` admits `app.coretask.org` through CORS, and the
refresh-token cookie stays host-only on `api.coretask.org`.

## Alternatives considered

**The API under `app.coretask.org/api`.** One origin for the app and its API
removes CORS from the picture, but needs an ingress that splits paths between
two services, and makes production differ from development, where the API has
always been an origin of its own.

**The app under `coretask.org/app`.** One domain for everything would put a
crawlable static site and an authenticated SPA behind the same server and cookie
scope, which 0001 and 0017 deliberately kept apart.

## Consequences

**Easier**

- A URL, a folder, a package and an image all say the same thing.
- Each origin deploys, caches and scales on its own; the website can go live
  before the app does.
- Production repeats development's topology, so cross-origin bugs show up
  locally first.

**Harder / accepted**

- `app.` and `api.` must stay on the same registrable domain: the `SameSite=lax`
  refresh cookie only travels with the app's requests because both are
  `coretask.org`.
- Every renamed path invalidates branches still using `web/` or `site/`; git's
  rename detection carries most of their changes across on merge.
- Records before this one still say `web/` and `site/`. They are left as written.
