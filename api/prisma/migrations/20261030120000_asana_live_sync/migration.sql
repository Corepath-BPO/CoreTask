-- CreateTable
CREATE TABLE "asana_live_syncs" (
    "workspaceId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledById" UUID,
    "enabledAt" TIMESTAMP(3),
    "needsFullSync" BOOLEAN NOT NULL DEFAULT false,
    "lastPolledAt" TIMESTAMP(3),
    "lastChangeAt" TIMESTAMP(3),
    "changesToday" INTEGER NOT NULL DEFAULT 0,
    "countedOn" DATE,
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asana_live_syncs_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "asana_event_streams" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectGid" VARCHAR(64) NOT NULL,
    "syncToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asana_event_streams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asana_event_streams_workspaceId_projectGid_key" ON "asana_event_streams"("workspaceId", "projectGid");

-- AddForeignKey
ALTER TABLE "asana_live_syncs" ADD CONSTRAINT "asana_live_syncs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_live_syncs" ADD CONSTRAINT "asana_live_syncs_enabledById_fkey" FOREIGN KEY ("enabledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_event_streams" ADD CONSTRAINT "asana_event_streams_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

