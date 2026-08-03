# 0003. PostgreSQL as the primary datastore

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

CoreTask's data is relational to its core: workspaces contain projects contain
sections contain tasks, which have subtasks, assignees, labels, comments and
attachments. Nearly every read is a join, and nearly every write must hold an
invariant across more than one table.

Two examples that decide the question:

- Creating a workspace must create the OWNER membership. A workspace without an
  administrator is unrecoverable.
- Issuing a ticket key must increment a per-workspace counter and insert the
  ticket. A gap or a duplicate is visible to users forever.

## Decision

Use **PostgreSQL 17** as the system of record, with Prisma as the client.

## Alternatives considered

**MongoDB.** Attractive for the flexible custom-fields feature. Rejected because
the rest of the model is relational: the joins would move into application code,
and the invariants above would depend on multi-document transactions — which
exist, but are the thing Mongo is least suited to. PostgreSQL's `jsonb` covers
the flexible-schema need without giving up referential integrity.

**MySQL / MariaDB.** Perfectly capable. PostgreSQL wins on the features this
product will actually use: `jsonb` with GIN indexing for custom fields,
`pg_trgm` for search, partial and expression indexes, `CTE`s and window
functions for reporting, and stricter default type behaviour.

**SQLite.** Fine for a prototype; no concurrent-writer story for a multi-tenant
SaaS.

## Consequences

**Easier**

- Foreign keys and unique constraints enforce invariants at the database, not by
  hope. `@@unique([workspaceId, userId])` makes duplicate membership impossible.
- Real transactions, so workspace-plus-owner and ticket-key-plus-counter are
  atomic.
- One store for relational data, JSON custom fields and full-text search — no
  second system to keep consistent.
- Prisma generates a fully typed client from the schema, so a column rename is a
  compile error.

**Harder / accepted**

- Schema changes need migrations. That is a feature: the migration history is
  reviewable and the deployed schema cannot drift.
- Horizontal write scaling requires deliberate work (read replicas, then
  partitioning by workspace). Nothing about the current model prevents it — every
  workspace-owned table already carries `workspaceId`, which is the natural
  partition key.
- Prisma's generated client is large. It stays in the API image and never reaches
  the browser.
