# Frontend architecture

React 19 + TypeScript, built by Vite. A single-page authenticated dashboard —
deliberately not Next.js, see [ADR 0001](../decisions/0001-react-with-vite.md).

## Structure

```
src/
├── app/
│   ├── config/        validated client env, sidebar navigation definition
│   ├── layouts/       root, auth (split screen), app (sidebar + topbar)
│   ├── providers/     Query, Auth (session restore), Socket, theme
│   └── router/        code-based TanStack Router tree
├── components/
│   ├── ui/            ShadCN primitives (vendored, kept close to upstream)
│   ├── common/        page header, placeholder page
│   ├── forms/         Field wrapper + aria helper
│   ├── navigation/    sidebar, topbar, mobile drawer, user menu
│   ├── feedback/      error boundary, empty state, skeletons, form error
│   └── data-display/  stat card, status badges
├── features/          vertical slices: auth, workspaces, dashboard, …
├── hooks/             cross-feature hooks
├── lib/
│   ├── api/           axios client, error type, query client + key factory
│   ├── socket/        Socket.IO client
│   ├── mock/          temporary dashboard fixtures (one file, one importer)
│   └── utils/         cn(), formatting helpers
├── stores/            Zustand: auth, workspace, ui, theme
└── styles/            Tailwind v4 theme tokens
```

A **feature** owns its API calls, hooks, components and pages. Anything two
features need moves to `components/` or `lib/`. Nothing in `components/` imports
from `features/`.

## State

Three kinds, three tools — mixing them is what makes dashboards unmaintainable:

| Kind          | Tool           | Examples                                |
| ------------- | -------------- | --------------------------------------- |
| Server state  | TanStack Query | workspaces, members, everything fetched |
| Session state | Zustand        | auth status and user, active workspace  |
| UI state      | Zustand        | sidebar collapsed, drawer open, theme   |

Query keys come from one factory (`lib/api/query-client.ts`) so invalidation
cannot miss a cache entry.

## Authentication in the browser

The access token lives in **module scope inside the API client** — not
`localStorage`, not a Zustand store that persists. Two consequences:

- An XSS payload that reads storage finds nothing.
- A reload starts with no token at all.

The session survives reloads through the HTTP-only refresh cookie: `AuthProvider`
calls `/auth/refresh` once on boot and the router holds rendering until that
settles. Routing before it resolves would bounce a signed-in user to `/login` on
every refresh.

Three details worth knowing:

1. **Single-flight refresh.** Several requests can 401 at once when a token
   expires. Without de-duplication, each would rotate the refresh token, and the
   second rotation would look like a replay and revoke the whole session.
2. **StrictMode guard.** React 18+ double-invokes effects in development;
   restoring twice would rotate twice and trigger the same replay detection.
   `AuthProvider` guards with a ref.
3. **Route protection is convenience, not security.** `beforeLoad` redirects an
   unauthenticated user to `/login` with the attempted path preserved. The API
   authorises every request independently — the guard exists so an expired
   session lands somewhere sensible instead of on an empty dashboard.

The `redirect` search parameter only accepts same-site paths, so it cannot be
turned into an open redirect.

## Routing

Code-based, not file-based. There is no generated `routeTree.gen.ts` to keep in
sync, so CI and the Docker build compile exactly what is committed.

The sidebar is generated from `app/config/navigation.ts`, and the router builds
its placeholder routes from the same list — a nav entry cannot point at a route
that does not exist.

## Styling

Tailwind v4 with a CSS-first theme: the tokens in `styles/globals.css` _are_ the
configuration, there is no `tailwind.config.js`.

Colours are OKLCH, which is perceptually uniform, so the dark theme is a
lightness inversion rather than a hand-tuned second palette. One accent carries
every primary action; status colours mean something (blocked, overdue, urgent)
and are never decoration — otherwise a busy screen reads as an alarm.

Dark mode is applied by an inline script in `index.html` before first paint, so a
dark-mode reload never flashes white. `stores/theme.store.ts` owns it from mount
onwards and follows the OS only while the preference is `system`.

## Accessibility

- Skip link to `#main-content`.
- `Field` renders errors in a live region and links them with `aria-describedby`;
  forms use `noValidate` so Zod's accessible messages are the only ones shown.
- The collapsed sidebar rail exposes tooltips, since the labels are hidden.
- The mobile drawer is a Radix Dialog, so focus trapping, Escape and scroll lock
  are not reimplemented.
- `prefers-reduced-motion` disables animation globally.
- Focus is visible for keyboard users only (`:focus-visible`).

## Placeholder data

The foundation ships authentication and workspaces. Tasks, tickets, projects and
activity have models and seeds but no endpoints, so the dashboard renders sample
content for those sections and says so on screen.

Every mock value lives in `lib/mock/dashboard.mock.ts`, imported only by
`features/dashboard`. Removing it is two steps: point the dashboard hooks at the
real endpoints, then delete the file.

## Testing

| Layer   | Tool                     | What it proves                           |
| ------- | ------------------------ | ---------------------------------------- |
| Unit    | Vitest + Testing Library | form validation, route guarding, helpers |
| Browser | Playwright               | real sign-in against the running stack   |

Unit tests mock the network so they assert the component's contract, not the
API's behaviour — the API's behaviour is covered by its own e2e suite.
`renderWithRouter` builds a route tree that mirrors the real nesting, because
pages address search params by route id.
