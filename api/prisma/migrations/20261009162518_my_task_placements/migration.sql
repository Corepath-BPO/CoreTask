-- CreateEnum
CREATE TYPE "MyTasksBucket" AS ENUM ('RECENTLY_ASSIGNED', 'TODAY', 'NEXT_WEEK', 'LATER');

-- CreateTable
CREATE TABLE "my_task_placements" (
    "userId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "bucket" "MyTasksBucket" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "my_task_placements_pkey" PRIMARY KEY ("userId","taskId")
);

-- CreateIndex
CREATE INDEX "my_task_placements_taskId_idx" ON "my_task_placements"("taskId");

-- AddForeignKey
ALTER TABLE "my_task_placements" ADD CONSTRAINT "my_task_placements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "my_task_placements" ADD CONSTRAINT "my_task_placements_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
