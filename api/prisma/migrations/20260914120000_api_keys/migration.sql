-- API keys: the credential a tool such as n8n presents. A key acts as a hidden
-- service-account user (users.isServiceAccount) whose membership row carries the
-- role, so every createdBy/author foreign key and the membership guard keep
-- working unchanged. Only the SHA-256 of the key is stored; the raw value is
-- shown once at creation. Revoking keeps the rows so history still names it.

-- AlterEnum
ALTER TYPE "ActivityEntity" ADD VALUE 'API_KEY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "createdById" UUID,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_userId_key" ON "api_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_tokenHash_key" ON "api_keys"("tokenHash");

-- CreateIndex
CREATE INDEX "api_keys_workspaceId_revokedAt_idx" ON "api_keys"("workspaceId", "revokedAt");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
