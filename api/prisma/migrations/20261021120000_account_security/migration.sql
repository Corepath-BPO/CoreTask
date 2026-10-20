-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'SAML');

-- CreateEnum
CREATE TYPE "SignInMethod" AS ENUM ('PASSWORD', 'GOOGLE', 'MICROSOFT', 'SAML');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarKey" VARCHAR(200),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "emailVerificationDueAt" TIMESTAMP(3),
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "method" "SignInMethod" NOT NULL DEFAULT 'PASSWORD',
ADD COLUMN     "sessionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "subject" VARCHAR(600) NOT NULL,
    "samlConnectionId" UUID,
    "email" VARCHAR(254) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_change_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "newEmail" VARCHAR(254) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saml_connections" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "idpEntityId" VARCHAR(500) NOT NULL,
    "idpSsoUrl" VARCHAR(2000) NOT NULL,
    "idpCertificate" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saml_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_domains" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "verificationToken" VARCHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

-- CreateIndex
CREATE INDEX "user_identities_samlConnectionId_idx" ON "user_identities"("samlConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_codeHash_key" ON "two_factor_recovery_codes"("codeHash");

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_userId_idx" ON "two_factor_recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_tokens_tokenHash_key" ON "email_change_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_change_tokens_userId_createdAt_idx" ON "email_change_tokens"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saml_connections_workspaceId_key" ON "saml_connections"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_domains_domain_idx" ON "workspace_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_domains_workspaceId_domain_key" ON "workspace_domains"("workspaceId", "domain");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_samlConnectionId_fkey" FOREIGN KEY ("samlConnectionId") REFERENCES "saml_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_change_tokens" ADD CONSTRAINT "email_change_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saml_connections" ADD CONSTRAINT "saml_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a session already open began when its first token was issued.
UPDATE "refresh_tokens" AS r
SET "sessionStartedAt" = s."startedAt"
FROM (
    SELECT "sessionId", MIN("createdAt") AS "startedAt"
    FROM "refresh_tokens"
    GROUP BY "sessionId"
) AS s
WHERE r."sessionId" = s."sessionId";

-- Backfill: people who never confirmed their address get the same week to do
-- so as a new account, counted from now rather than from when they signed up.
UPDATE "users"
SET "emailVerificationDueAt" = CURRENT_TIMESTAMP + INTERVAL '7 days'
WHERE "emailVerifiedAt" IS NULL AND "isServiceAccount" = false;
