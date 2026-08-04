-- The composite unique on (workspaceId, projectId, slug) does not constrain the
-- workspace-level rows: `projectId` is NULL for those, and in PostgreSQL NULL is
-- never equal to NULL, so any number of duplicates would be accepted. A partial
-- unique index is the standard way to express "unique among the rows where this
-- column is null".
CREATE UNIQUE INDEX "status_definitions_workspace_slug_key"
  ON "status_definitions" ("workspaceId", "slug")
  WHERE "projectId" IS NULL;
