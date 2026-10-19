-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "myTasksRules" JSONB NOT NULL DEFAULT '{}';
