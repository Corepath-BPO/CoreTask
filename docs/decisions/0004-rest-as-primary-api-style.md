# 0004. REST as the primary API style

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

The API serves the CoreTask web client today, and will eventually serve mobile
clients, customer integrations, webhooks and an automation engine. It has to be
documentable, cacheable and consumable by people who are not us.

## Decision

**REST over HTTP** under `/api/v1`, documented with OpenAPI at `/api/docs`, using
one response envelope for every endpoint. Socket.IO carries realtime events; it
does not carry commands.

## Alternatives considered

**GraphQL.** Genuinely good at the shape of a project-management UI — a board
view wants tasks, assignees, labels and comment counts in one round trip. It was
rejected for now on operational cost, not capability: query-depth and complexity
limits, per-field authorisation, the N+1 problem needing DataLoader everywhere,
and caching that HTTP no longer does for you. Those are all solvable, and none of
them is free. A REST endpoint shaped for each view solves the same round-trip
problem with a fraction of the machinery.

GraphQL remains a reasonable _additive_ choice later, sitting in front of the same
services.

**tRPC.** The best developer experience for a TypeScript-only client and a
significant temptation given this is a TypeScript monorepo. Rejected because it
does not produce a contract that a non-TypeScript consumer can use, and the API
is meant to be a product surface, not an internal detail. We keep most of the
benefit anyway: `@coretask/types` and `@coretask/contracts` give the web client
end-to-end types over REST.

**gRPC.** Right for service-to-service traffic; wrong for a browser-facing public
API.

## Consequences

**Easier**

- The OpenAPI document is generated from the code that actually runs, so external
  consumers get an accurate, always-current contract.
- Every HTTP tool works: curl, Postman, proxies, CDNs, WAFs, rate limiters and
  API gateways all understand verbs, paths and status codes.
- Caching and idempotency are HTTP's problem, not ours.
- One envelope means the client unwraps responses in exactly one place.

**Harder / accepted**

- Over- and under-fetching. Managed by shaping endpoints for real views rather
  than exposing raw tables, and by paginating everything.
- Multi-resource screens may need several requests. TanStack Query parallelises
  and caches them; where it genuinely hurts, the fix is a purpose-built endpoint.
- Versioning is manual. The `/api/v1` prefix exists from day one so a breaking
  change has somewhere to go.
- Endpoint types are maintained by hand in `@coretask/types`. Cheap, and it keeps
  the shared packages free of any server dependency.
