-- CreateTable
CREATE TABLE "goal_updates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "authorId" UUID,
    "status" "GoalStatus" NOT NULL,
    "progress" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_updates_goalId_createdAt_idx" ON "goal_updates"("goalId", "createdAt");

-- AddForeignKey
ALTER TABLE "goal_updates" ADD CONSTRAINT "goal_updates_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_updates" ADD CONSTRAINT "goal_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
