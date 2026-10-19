-- CreateTable
CREATE TABLE "home_layouts" (
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "widgets" TEXT[],
    "notepad" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_layouts_pkey" PRIMARY KEY ("userId","workspaceId")
);

-- AddForeignKey
ALTER TABLE "home_layouts" ADD CONSTRAINT "home_layouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_layouts" ADD CONSTRAINT "home_layouts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
