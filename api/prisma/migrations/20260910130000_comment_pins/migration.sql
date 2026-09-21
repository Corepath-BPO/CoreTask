-- One comment per thread can be pinned to the top. Who pinned it is kept for
-- the story; losing that person leaves the pin in place.

ALTER TABLE "comments" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "comments" ADD COLUMN "pinnedById" UUID;

ALTER TABLE "comments" ADD CONSTRAINT "comments_pinnedById_fkey"
    FOREIGN KEY ("pinnedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
