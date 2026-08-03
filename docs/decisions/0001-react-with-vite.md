# 0001. React with Vite, not Next.js, for the dashboard

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

CoreTask is an authenticated project-management dashboard. Essentially every
screen sits behind a login, renders per-user data, and is useless to a crawler.
Marketing and documentation pages will exist, but they are a different product
surface with different requirements.

## Decision

Build the authenticated application as a **client-rendered SPA with React and
Vite**.

A separate `site/` application (Next.js is the likely choice) may be added later
for public marketing and SEO pages. It is explicitly out of scope now.

## Alternatives considered

**Next.js for everything.** Server components, streaming SSR and file-based
routing are real advantages — for public, cacheable, SEO-relevant pages. Behind a
login none of that applies: nothing is crawlable, nothing is shareable, and every
render is per-user. What remains is a server runtime we would have to deploy,
scale and secure alongside the API, plus a second place where authentication has
to be understood. The cost is real; the benefit is not.

**Remix / React Router framework mode.** Same reasoning. Its loader model is
excellent for server-rendered data, but we already have a REST API and TanStack
Query, so the loaders would mostly be a proxy layer.

**Vite + SSR by hand.** All the operational cost of a server runtime with none of
the framework support.

## Consequences

**Easier**

- The client is a static bundle: a CDN or an nginx container, no Node.js at
  runtime, trivially scaled and cached.
- One authentication story. Tokens live in the browser and travel to the API;
  there is no server-side session to keep in sync.
- Fast builds and near-instant HMR.
- The API is the only backend. It cannot be bypassed by a server component that
  quietly reaches into the database.

**Harder / accepted**

- No SEO for the app. Intended — it is behind a login.
- First paint waits for the JS bundle. Mitigated by chunk splitting and an inline
  theme script; for an app people keep open all day, first paint is not the
  metric that matters.
- Environment values are baked in at build time, so changing the API origin means
  rebuilding the image.
- When the marketing site arrives it is a second application to maintain. That is
  the point: its requirements are genuinely different.
