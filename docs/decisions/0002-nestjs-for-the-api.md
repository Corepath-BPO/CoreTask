# 0002. NestJS for the API

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

The API will grow to cover workspaces, projects, sections, tasks, tickets,
comments, attachments, custom fields, activity logs, notifications, automations,
reports and time tracking — with realtime and background processing throughout.

The problem is not "can we serve HTTP", it is keeping ~20 feature areas
consistent as several people work on them over a long period.

## Decision

Use **NestJS** with a controller → service → Prisma layering, dependency
injection, and modules as the unit of feature ownership.

## Alternatives considered

**Express or Fastify directly.** Faster to start, and no framework to learn. But
every cross-cutting concern — validation, auth, error shape, logging context,
transactions — becomes a convention that has to be remembered rather than a
structure that is provided. At twenty feature areas, "remembered" reliably means
"inconsistent". Nest gives global pipes, guards, filters and interceptors as
first-class concepts, which is exactly how the response envelope and tenant
isolation are enforced here.

**tRPC.** Excellent end-to-end types for a TypeScript-only client. Rejected
because the API is a product surface: a documented REST contract with an OpenAPI
document serves third-party integrations, mobile clients and webhooks, none of
which can consume tRPC. See [ADR 0004](0004-rest-as-primary-api-style.md).

**AdonisJS.** Comparable structure, much smaller ecosystem and hiring pool.

## Consequences

**Easier**

- Cross-cutting concerns are declared once and applied globally. The response
  envelope, error shape and correlation id are structural, not conventional.
- DI makes services testable without a running server, and the e2e suite can boot
  the _real_ application because the wiring is explicit.
- `@nestjs/swagger` derives the OpenAPI document from the code that actually runs,
  so the docs cannot silently drift.
- First-class BullMQ and WebSocket integrations, so the worker and the gateway
  share the API's module system rather than being bolted on.

**Harder / accepted**

- Decorators and DI are a learning curve for people coming from Express.
- More boilerplate per endpoint (module, controller, service, DTO). That verbosity
  is what keeps twenty feature areas looking the same.
- `emitDecoratorMetadata` constrains tooling: `consistent-type-imports` has to be
  off in the API, because rewriting an injected class to `import type` breaks DI
  at runtime. This is documented in `packages/eslint-config/node.js`.
- Slightly slower cold start than a bare Express app. Irrelevant for a
  long-running service.
