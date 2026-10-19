-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('NO_STATUS', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED', 'PARTIAL', 'MISSED', 'DROPPED');

-- CreateEnum
CREATE TYPE "GoalProgressSource" AS ENUM ('MANUAL', 'SUB_GOALS', 'PROJECTS');

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'NO_STATUS',
    "progressSource" "GoalProgressSource" NOT NULL DEFAULT 'MANUAL',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "ownerId" UUID,
    "teamId" UUID,
    "timePeriod" VARCHAR(32),
    "dueDate" TIMESTAMP(3),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_projects" (
    "goalId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_projects_pkey" PRIMARY KEY ("goalId","projectId")
);

-- CreateIndex
CREATE INDEX "goals_workspaceId_archivedAt_idx" ON "goals"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "goals_parentId_idx" ON "goals"("parentId");

-- CreateIndex
CREATE INDEX "goal_projects_projectId_idx" ON "goal_projects"("projectId");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_projects" ADD CONSTRAINT "goal_projects_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_projects" ADD CONSTRAINT "goal_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
