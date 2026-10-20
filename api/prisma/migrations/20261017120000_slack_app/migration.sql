-- AlterTable
ALTER TABLE "webhook_endpoints" ADD COLUMN     "slackChannelId" VARCHAR(32),
ADD COLUMN     "slackChannelName" VARCHAR(120);

-- CreateTable
CREATE TABLE "slack_installations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "teamId" VARCHAR(32) NOT NULL,
    "teamName" VARCHAR(200) NOT NULL,
    "botUserId" VARCHAR(32) NOT NULL,
    "botToken" TEXT NOT NULL,
    "scopes" TEXT[],
    "installedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_user_links" (
    "id" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "slackUserId" VARCHAR(32) NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_user_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_installations_workspaceId_key" ON "slack_installations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_installations_teamId_key" ON "slack_installations"("teamId");

-- CreateIndex
CREATE INDEX "slack_user_links_userId_idx" ON "slack_user_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_user_links_installationId_slackUserId_key" ON "slack_user_links"("installationId", "slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_user_links_installationId_userId_key" ON "slack_user_links"("installationId", "userId");

-- AddForeignKey
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_installedById_fkey" FOREIGN KEY ("installedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "slack_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

