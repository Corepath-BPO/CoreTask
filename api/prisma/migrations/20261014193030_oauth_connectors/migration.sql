-- AlterTable
ALTER TABLE "webhook_endpoints" ADD COLUMN     "apiKeyId" UUID,
ADD COLUMN     "oauthGrantId" UUID;

-- CreateTable
CREATE TABLE "oauth_apps" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "websiteUrl" VARCHAR(2048),
    "redirectUris" TEXT[],
    "clientId" VARCHAR(64) NOT NULL,
    "clientSecretHash" VARCHAR(64) NOT NULL,
    "secretHint" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "scopes" TEXT[],
    "codeChallenge" VARCHAR(128),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "grantId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" UUID NOT NULL,
    "appId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scopes" TEXT[],
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_access_tokens" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_apps_clientId_key" ON "oauth_apps"("clientId");

-- CreateIndex
CREATE INDEX "oauth_apps_ownerId_idx" ON "oauth_apps"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_codeHash_key" ON "oauth_authorization_codes"("codeHash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_expiresAt_idx" ON "oauth_authorization_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_grants_refreshTokenHash_key" ON "oauth_grants"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "oauth_grants_userId_revokedAt_idx" ON "oauth_grants"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "oauth_grants_appId_revokedAt_idx" ON "oauth_grants"("appId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_tokens_tokenHash_key" ON "oauth_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "oauth_access_tokens_grantId_expiresAt_idx" ON "oauth_access_tokens"("grantId", "expiresAt");

-- CreateIndex
CREATE INDEX "webhook_endpoints_apiKeyId_idx" ON "webhook_endpoints"("apiKeyId");

-- CreateIndex
CREATE INDEX "webhook_endpoints_oauthGrantId_idx" ON "webhook_endpoints"("oauthGrantId");

-- AddForeignKey
ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_appId_fkey" FOREIGN KEY ("appId") REFERENCES "oauth_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_appId_fkey" FOREIGN KEY ("appId") REFERENCES "oauth_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_oauthGrantId_fkey" FOREIGN KEY ("oauthGrantId") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
