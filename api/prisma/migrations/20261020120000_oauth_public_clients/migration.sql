-- AlterTable
ALTER TABLE "oauth_apps" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "clientSecretHash" DROP NOT NULL,
ALTER COLUMN "secretHint" DROP NOT NULL;
