-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('TASK', 'MILESTONE', 'APPROVAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "approvalStatus" "ApprovalStatus",
ADD COLUMN     "kind" "TaskKind" NOT NULL DEFAULT 'TASK';
