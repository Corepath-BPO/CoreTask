-- CreateEnum
CREATE TYPE "OAuthAppPolicy" AS ENUM ('ANY', 'APPROVED');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "oauthAppPolicy" "OAuthAppPolicy" NOT NULL DEFAULT 'ANY';

-- CreateTable
CREATE TABLE "workspace_oauth_apps" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "approvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_oauth_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_oauth_apps_appId_idx" ON "workspace_oauth_apps"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_oauth_apps_workspaceId_appId_key" ON "workspace_oauth_apps"("workspaceId", "appId");

-- AddForeignKey
ALTER TABLE "workspace_oauth_apps" ADD CONSTRAINT "workspace_oauth_apps_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_oauth_apps" ADD CONSTRAINT "workspace_oauth_apps_appId_fkey" FOREIGN KEY ("appId") REFERENCES "oauth_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_oauth_apps" ADD CONSTRAINT "workspace_oauth_apps_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
