-- CreateTable
CREATE TABLE "project_stars" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_stars_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateIndex
CREATE INDEX "project_stars_userId_position_idx" ON "project_stars"("userId", "position");

-- AddForeignKey
ALTER TABLE "project_stars" ADD CONSTRAINT "project_stars_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stars" ADD CONSTRAINT "project_stars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
