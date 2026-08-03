# Architecture decision records

Each record captures one decision: the context that forced it, what was chosen,
the alternatives that were rejected and why, and what the choice costs.

Records are immutable. When a decision changes, add a new record that supersedes
the old one and update the status line here — rewriting history hides the reason
the original choice made sense at the time.

| #                                           | Decision                                        | Status   |
| ------------------------------------------- | ----------------------------------------------- | -------- |
| [0001](0001-react-with-vite.md)             | React with Vite, not Next.js, for the dashboard | Accepted |
| [0002](0002-nestjs-for-the-api.md)          | NestJS for the API                              | Accepted |
| [0003](0003-postgresql-as-primary-store.md) | PostgreSQL as the primary datastore             | Accepted |
| [0004](0004-rest-as-primary-api-style.md)   | REST as the primary API style                   | Accepted |
| [0005](0005-redis-and-bullmq.md)            | Redis and BullMQ for background work            | Accepted |
| [0006](0006-independent-deployability.md)   | Frontend and backend independently deployable   | Accepted |
| [0007](0007-uuid-v7-primary-keys.md)        | UUID v7 primary keys                            | Accepted |
| [0008](0008-refresh-token-rotation.md)      | Rotating refresh tokens in an HTTP-only cookie  | Accepted |

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

What forced a decision.

## Decision

What we chose.

## Alternatives considered

What else was on the table, and why it lost.

## Consequences

What this makes easy, what it makes hard, and what we accept.
```
