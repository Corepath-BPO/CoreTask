-- Runs once, when the PostgreSQL data volume is first created.
--
-- CoreTask generates UUID v7 primary keys in the application layer (Prisma's
-- `@default(uuid(7))`), so no UUID extension is required for normal operation.
-- pgcrypto is enabled anyway because `gen_random_uuid()` is useful in ad-hoc
-- SQL, backfills and test fixtures.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram indexes for the search work in the next phase (task/ticket titles).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
