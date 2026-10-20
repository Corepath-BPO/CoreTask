-- AlterTable
ALTER TABLE "project_members" ADD COLUMN     "notifyOn" TEXT[] DEFAULT ARRAY['STATUS_UPDATES', 'MESSAGES']::TEXT[];
